import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from './config'; 
import Reports from './pages/Reports';

// --- Configuration ---
const BOTTLE_PRICE = 42; 

// --- Helper Functions ---
const backendToUiStatus = (s) => {
    if (!s) return 'Unknown';
    const status = s.toLowerCase();
    if (status === 'pending') return 'Pending';
    if (status === 'accepted') return 'Accepted';
    if (status === 'in_transit') return 'In Transit';
    if (status === 'delivered') return 'Delivered';
    if (status === 'resolved' || status === 'delivered_confirmed') return 'Resolved'; // Use 'Resolved' for UI
    if (status === 'cancelled') return 'Cancelled';
    return s;
};

// --- Export Helper (Simulated XLSX functionality for CSV) ---
const exportOrdersToCSV = (orders, channelName) => {
    if (orders.length === 0) {
        alert("No orders available to export.");
        return;
    }

    const headers = [
        "Order ID",
        "Store Name",
        "Bottles",
        "Status",
        "Ordered By (Partner)",
        "Order Date",
    ];

    const csvData = orders.map(order => {
        const escape = (value) => `"${String(value).replace(/"/g, '""')}"`;
        
        return [
            escape(`#${order.id}`),
            escape(order.customerName),
            order.bottles,
            escape(order.status),
            escape(order.partnerName),
            escape(order.orderDate.toLocaleString()),
        ].join(',');
    });

    const csvContent = [headers.join(','), ...csvData].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');

    const today = new Date().toISOString().slice(0, 10);
    const filename = `${channelName}_Orders_Export_${today}.csv`;

    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    alert('Orders exported to CSV successfully!');
};


// --- Reusable Components ---
const StatCard = ({ label, value, icon, bgColor, textColor, onPress }) => (
    <div 
        style={{ ...styles.statCard, backgroundColor: bgColor, color: textColor }} 
        onClick={onPress}
    >
        <div style={styles.statIcon}>{icon}</div>
        <div style={styles.statContent}>
            <p style={styles.statValue}>{value}</p>
            <p style={styles.statLabel}>{label}</p>
        </div>
    </div>
);

const SidebarItem = ({ label, icon, name, active, onSelect }) => (
    <button
        key={name}
        style={{ ...styles.sidebarItem, ...(active ? styles.sidebarItemActive : {}) }}
        onClick={() => onSelect(name)}
    >
        <span style={styles.sidebarIcon}>{icon}</span>
        <span style={styles.sidebarText}>{label}</span>
    </button>
);

const Sidebar = ({ currentTab, onSelectTab, channelName }) => (
    <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
            <p style={styles.sidebarHeaderTitle}>{channelName.toUpperCase()} Admin</p>
        </div>
        <nav style={styles.sidebarNav}>
            <SidebarItem label="Dashboard" icon="🏠" name="dashboard" active={currentTab === 'dashboard'} onSelect={onSelectTab} />
            <SidebarItem label="Orders" icon="📦" name="orders" active={currentTab === 'orders'} onSelect={onSelectTab} />
            <SidebarItem label="Unassigned Orders" icon="🚫" name="unassignedOrders" active={currentTab === 'unassignedOrders'} onSelect={onSelectTab} />
            <SidebarItem label="Stores" icon="🏬" name="stores" active={currentTab === 'stores'} onSelect={onSelectTab} />
            <SidebarItem label="My POC" icon="🤝" name="partners" active={currentTab === 'partners'} onSelect={onSelectTab} />
            <SidebarItem label="Complaints" icon="💬" name="complaints" active={currentTab === 'complaints'} onSelect={onSelectTab} />           
            <SidebarItem label="Reports" icon="📊" name="reports" active={currentTab === 'reports'} onSelect={onSelectTab} />
        </nav>
    </aside>
);

// --- Complaint Resolution Modal Component ---
const ComplaintResolutionModal = ({ isVisible, onClose, onSubmit, complaint, solutionText, setSolutionText, isLoading }) => {
    if (!isVisible || !complaint) return null;

    const handleFormSubmit = (e) => {
        e.preventDefault();
        onSubmit(e);
    };

    return (
        <div style={styles.modalStyles.backdrop}>
            <div style={styles.modalStyles.modal}>
                <h3 style={styles.modalStyles.title}>Resolve Complaint #{complaint.id}</h3>
                <p style={styles.modalSubtitle}>**Subject:** {complaint.subject}</p>
                <p style={styles.modalSubtitle}>**Raised By:** {complaint.created_by?.full_name || 'N/A'}</p>
                <p style={styles.modalSubtitle}>**Description:** {complaint.description}</p>
                <form onSubmit={handleFormSubmit}>
                    <textarea
                        style={styles.modalStyles.textarea}
                        placeholder="Enter your resolution message..."
                        value={solutionText}
                        onChange={(e) => setSolutionText(e.target.value)}
                        required
                        rows={5}
                        disabled={isLoading}
                    />
                    <div style={styles.modalStyles.actions}>
                        <button type="button" onClick={onClose} style={styles.modalStyles.cancelButton} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" style={styles.modalStyles.submitButton} disabled={isLoading || !solutionText.trim()}>
                            {isLoading ? 'Resolving...' : 'Submit Resolution'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const ChannelAdminDashboard = () => {
    const [loading, setLoading] = useState(true);
    const [currentTab, setCurrentTab] = useState('dashboard');
    const [channelName, setChannelName] = useState(localStorage.getItem('channel_name') || "CHANNEL"); 
    
    // Data states for tabs
    const [storesList, setStoresList] = useState([]);
    const [partnersList, setPartnersList] = useState([]);
    const [channelOrders, setChannelOrders] = useState([]); 
    const [channelComplaints, setChannelComplaints] = useState([]);
    const [reports, setReports] = useState([]);
    const [reportsTab, setReportsTab] = useState("monthly");
    

    const [dashboardData, setDashboardData] = useState({
        totalStores: 0,
        totalPartners: 0,
        totalOrders: 0,
        pendingOrders: 0, 
        pendingComplaints: 0, // NEW KPI
    });
    const navigate = useNavigate();

    const orphanedOrders = useMemo(() => {
        // Orders from stores within this channel that have no assigned manager
        return channelOrders.filter(order => {
            const store = storesList.find(s => s.id === order.store_id);
            return store && !store.assigned_manager_id && order.status !== 'Delivered';
        });
    }, [channelOrders, storesList]);

    // Complaint Resolution States
    const [selectedComplaint, setSelectedComplaint] = useState(null);
    const [solutionText, setSolutionText] = useState("");
    const [showResolveModal, setShowResolveModal] = useState(false);
    const [resolvingComplaint, setResolvingComplaint] = useState(false);

    // New Partner Creation State
    const [newPartnerName, setNewPartnerName] = useState("");
    const [newPartnerEmail, setNewPartnerEmail] = useState("");
    const [newPartnerPassword, setNewPartnerPassword] = useState("");
    const [newPartnerMobile, setNewPartnerMobile] = useState("");



    const formatReportMonth = (dateString) => {
    if (!dateString) return 'N/A';
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch (e) {
        return dateString;
    }
};

    // --- Logout Handler ---
    const handleLogout = () => {
        ['auth_token', 'userToken', 'partner_token', 'user_role', 'channel_name'].forEach(key => localStorage.removeItem(key));
        alert('You have been logged out.');
        navigate('/login'); 
    };

    // --- Core Action: Create Partner for this Channel ---
    const handleCreateChannelPartner = async (e) => {
        e.preventDefault();
        const token = localStorage.getItem("auth_token");
        const channel = channelName; 

        if (!token) {
            alert("Authentication token missing. Please log in again.");
            handleLogout();
            return;
        }

        if (!newPartnerName || !newPartnerEmail || !newPartnerPassword) {
            alert("Please fill in all required partner fields.");
            return;
        }

        setLoading(true);
        try {
            const response = await axios.post(
                `${API_BASE_URL}/partners/channel-admin/create-partner`,
                {
                    full_name: newPartnerName,
                    email: newPartnerEmail,
                    password: newPartnerPassword,
                    mobile_number: newPartnerMobile,
                    channel: channel, 
                    role: 'partner'
                },
                {
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                }
            );

            alert(`✅ Partner ${newPartnerName} created successfully under channel ${channel}!`);
            
            // Clear form and refresh data
            setNewPartnerName("");
            setNewPartnerEmail("");
            setNewPartnerPassword("");
            setNewPartnerMobile("");
            const freshToken = localStorage.getItem("auth_token");
            fetchData(freshToken, channel); 
            setCurrentTab('partners');

        } catch (error) {
            console.error("Error creating channel partner:", error.response?.data || error.message);
            alert(error.response?.data?.detail || "Failed to create channel partner. Check if user already exists.");
        } finally {
            setLoading(false);
        }
    };

    // --- Core Action: Fetch Complaints for this Channel ---
    const fetchChannelComplaints = async (token) => {
        try {
            const res = await axios.get(
                `${API_BASE_URL}/complaints/complaints/channel-admin/my-channel`,
                { headers: { Authorization: `Bearer ${token}` } }
            );

            setChannelComplaints(res.data);

            setDashboardData((prev) => ({
                ...prev,
                pendingComplaints: res.data.filter((c) => c.status?.toLowerCase() === "pending").length,
            }));
        } catch (err) {
            console.log("Error loading channel complaints", err);
            setChannelComplaints([]);
            setDashboardData((prev) => ({ ...prev, pendingComplaints: 0 }));
        }
    };




    const fetchReports = async (token) => {
        try {
            const res = await axios.get(`${API_BASE_URL}/reports/reports/list`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setReports(res.data);
        } catch (err) {
            console.error("Error fetching reports", err);
        }
    };

    const handleReportDownload = async (reportId) => {
        const token = localStorage.getItem('auth_token');
        try {
            const response = await axios.get(`${API_BASE_URL}/reports/reports/download/${reportId}`, {
                headers: { Authorization: `Bearer ${token}` },
                responseType: 'blob',
            });

            const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
            window.open(url, '_blank');
        } catch (error) {
            alert("Report file could not be opened. It may have been removed from the server.");
        }
    };
    // --- Complaint Resolution Handlers ---

    const handleResolveClick = (complaint) => {
        setSelectedComplaint(complaint);
        setSolutionText('');
        setShowResolveModal(true);
    };

    const handleCloseModal = () => {
        setShowResolveModal(false);
        setSelectedComplaint(null);
        setSolutionText('');
    };

    const handleComplaintResolveSubmit = async (e) => {
        e.preventDefault();

        const token = localStorage.getItem('auth_token');
        const trimmedText = solutionText.trim();

        if (!trimmedText || !selectedComplaint || !token) {
            alert('Missing resolution text or authentication.');
            return;
        }

        setResolvingComplaint(true);
        try {
            const payload = { status: 'resolved', solution: trimmedText };
            const response = await axios.patch(
                `${API_BASE_URL}/complaints/complaints/${selectedComplaint.id}/resolve`,
                payload,
                { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
            );

            if (response.status === 200) {
                alert(`Complaint #${selectedComplaint.id} successfully resolved.`);
                handleCloseModal();
                const freshToken = localStorage.getItem("auth_token");
                // Refresh data after resolution
                fetchData(freshToken, channelName); 
                fetchChannelComplaints(freshToken);
            } else {
                throw new Error(`Server responded with ${response.status}`);
            }
        } catch (error) {
            console.error('Complaint resolution failed:', error.response?.data || error.message);
            alert(`Failed: ${error.response?.data?.detail || error.message}`);
        } finally {
            setResolvingComplaint(false);
        }
    };

    // --- Data Fetching Function ---
    const fetchData = (token, currentChannel) => {
        setLoading(true);

        // Fetch Dashboard Data (Orders, Stores, Partners)
        const dashboardPromise = axios
            .get(`${API_BASE_URL}/channel-admin/channel-admin/me/dashboard`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((response) => {
                const data = response.data;
                const fetchedOrders = data.orders || [];
                const fetchedPartners = data.partners || [];
                const fetchedStores = data.stores || [];

                // Calculate KPIs
                const pendingOrders = fetchedOrders.filter(o => o.status?.toLowerCase() === 'pending').length;

                setDashboardData(prev => ({
                    ...prev,
                    totalStores: data.total_stores || 0,
                    totalPartners: data.total_partners || 0,
                    totalOrders: fetchedOrders.length || 0, 
                    pendingOrders: pendingOrders,
                }));

                // Prepare Partner List
                setPartnersList(fetchedPartners); 
                
                // Prepare Orders List
                const mappedOrders = fetchedOrders.map(order => ({
                    id: order.id,
                    bottles: order.bottles,
                    status: backendToUiStatus(order.status),
                    orderDate: new Date(order.created_at),
                    customerName: order.store?.store_name || order.customer_name || 'Customer', // Fallback for customer name
                    partnerName: order.partner?.full_name || 'N/A',
                    isPartnerOrder: !!order.partner_id,
                    store_id: order.store_id,
                }));
                setChannelOrders(mappedOrders);

                // Prepare Stores List: Integrate Partner name(s) and order count
                const mappedStores = fetchedStores.map(store => {
                    const assignedPartners = fetchedPartners.filter(partner => 
                        partner.stores && partner.stores.some(s => s.id === store.id)
                    );

                    return {
                        ...store,
                        partner_name: store.assigned_manager_name || store.assigned_manager_id || "Unassigned",
                        order_count: mappedOrders.filter(o => o.store_id === store.id).length || 0, 
                    };
                });
                setStoresList(mappedStores);
            });
            
        // Fetch Complaints (parallel fetch)
        const complaintsPromise = fetchChannelComplaints(token);

        Promise.all([dashboardPromise, complaintsPromise])
            .catch((error) => {
                console.error(
                    `[DASHBOARD FETCH FAILED]: Status ${error.response?.status}`,
                    error.response?.data || error.message
                );
                if (error.response?.status === 401) handleLogout();
                alert(`DATA LOADING FAILED! Check console for API error.`);
            })
            .finally(() => {
                setLoading(false);
            });
    };

    // --- Export Handler ---
    const handleExportOrdersToCSV = () => {
        exportOrdersToCSV(channelOrders, channelName.toUpperCase());
    };

    // --- Initial Data Fetch Effect ---
    useEffect(() => {
        const token = localStorage.getItem("auth_token");
        const storedChannel = localStorage.getItem("channel_name");

        if (token && storedChannel) {
            setChannelName(storedChannel.toUpperCase());
            fetchData(token, storedChannel.toUpperCase());
            fetchReports(token);
        } else {
            handleLogout();
        }
    }, [navigate]); 

    const handleSelectTab = (tabName) => {
        setCurrentTab(tabName);
    };


    // --- Render Functions for Tabs ---

    const renderDashboard = () => (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>Dashboard Overview</h2>

            <div style={styles.kpiRow}>
                <StatCard 
                    label={`Total Orders`} 
                    value={dashboardData.totalOrders.toString()} 
                    icon="📦" 
                    bgColor="#E3F2FD" 
                    textColor="#1565C0" 
                    onPress={() => setCurrentTab('orders')}
                />
                <StatCard 
                    label={`Pending Orders`} 
                    value={dashboardData.pendingOrders.toString()} 
                    icon="⏰" 
                    bgColor="#FFF3E0" 
                    textColor="#EF6C00" 
                    onPress={() => setCurrentTab('orders')}
                />
                <StatCard 
                    label={`Pending Complaints`} 
                    value={dashboardData.pendingComplaints.toString()} 
                    icon="🚨" 
                    bgColor="#FFEBEE" 
                    textColor="#D32F2F" 
                    onPress={() => setCurrentTab('complaints')}
                />
                <StatCard 
                    label={`Stores under ${channelName}`} 
                    value={dashboardData.totalStores.toString()} 
                    icon="🏬" 
                    bgColor="#E8F5E9" 
                    textColor="#388E3C" 
                    onPress={() => setCurrentTab('stores')}
                />
            </div>
            
            {/* Recent Orders List Preview */}
             <div style={styles.tableCard}>
                <h3 style={styles.cardTitle}>Recent Orders</h3>
                <table style={styles.dataTable}>
                    <thead>
                        <tr style={styles.tableHeaderRow}>
                            <th style={styles.tableHeaderCell}>Order ID</th>
                            <th style={styles.tableHeaderCell}>Store/Customer</th>
                            <th style={styles.tableHeaderCell}>Bottles</th>
                            <th style={styles.tableHeaderCell}>Status</th>
                            <th style={styles.tableHeaderCell}>Order Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        {channelOrders.slice(0, 5).sort((a, b) => b.orderDate - a.orderDate).map(order => (
                            <tr key={order.id} style={styles.tableRow}>
                                <td style={styles.tableCell}>#{order.id}</td>
                                <td style={styles.tableCell}>{order.customerName}</td>
                                <td style={styles.tableCell}>{order.bottles}</td>
                                <td style={styles.tableCell}>
                                    <span style={{
                                        ...styles.statusBadge,
                                        backgroundColor: 
                                            order.status === 'Delivered' || order.status === 'Resolved' ? '#4CAF50' : 
                                            order.status === 'Pending' ? '#FF9800' : 
                                            order.status === 'Cancelled' ? '#D32F2F' : '#2196F3'
                                    }}>
                                        {order.status}
                                    </span>
                                </td>
                                <td style={styles.tableCell}>{order.orderDate.toLocaleDateString()}</td>
                            </tr>
                        ))}
                         {channelOrders.length === 0 && (
                            <tr style={styles.tableRow}><td colSpan="5" style={{...styles.tableCell, textAlign: 'center'}}>No recent orders found for this channel.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
    
    // RENDER ORDERS TAB
    const renderOrders = () => (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>{channelName.toUpperCase()} Order History ({channelOrders.length})</h2>
            
            <button 
                style={{...styles.button, backgroundColor: '#1565C0', maxWidth: '300px', marginBottom: '20px', alignSelf: 'flex-start'}}
                onClick={handleExportOrdersToCSV}
                disabled={loading || channelOrders.length === 0}
            >
                {loading ? 'Processing...' : 'Export All Orders to CSV'}
            </button>

            <div style={styles.tableCard}>
                <h3 style={styles.cardTitle}>All Orders</h3>
                <table style={styles.dataTable}>
                    <thead>
                        <tr style={styles.tableHeaderRow}>
                            <th style={styles.tableHeaderCell}>Order ID</th>
                            <th style={styles.tableHeaderCell}>Store Name</th>
                            <th style={styles.tableHeaderCell}>Bottles</th>
                            <th style={styles.tableHeaderCell}>Status</th>
                            <th style={styles.tableHeaderCell}>Ordered By (Partner)</th>
                            <th style={styles.tableHeaderCell}>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        {channelOrders.sort((a, b) => b.orderDate - a.orderDate).map(order => (
                            <tr key={order.id} style={styles.tableRow}>
                                <td style={styles.tableCell}>#{order.id}</td>
                                <td style={styles.tableCell}>{order.customerName}</td>
                                <td style={styles.tableCell}>{order.bottles}</td>
                                <td style={styles.tableCell}>
                                    <span style={{
                                        ...styles.statusBadge,
                                        backgroundColor: 
                                            order.status === 'Delivered' || order.status === 'Resolved' ? '#4CAF50' : 
                                            order.status === 'Pending' ? '#FF9800' : 
                                            order.status === 'Cancelled' ? '#D32F2F' : '#2196F3'
                                    }}>
                                        {order.status}
                                    </span>
                                </td>
                                <td style={styles.tableCell}>{order.partnerName}</td>
                                <td style={styles.tableCell}>{order.orderDate.toLocaleString()}</td>
                            </tr>
                        ))}
                         {channelOrders.length === 0 && (
                            <tr style={styles.tableRow}><td colSpan="6" style={{...styles.tableCell, textAlign: 'center'}}>{loading ? 'Loading...' : 'No orders found.'}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderStores = () => (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>{channelName.toUpperCase()} Store Network ({storesList.length})</h2>
            <div style={styles.tableCard}>
                <h3 style={styles.cardTitle}>All Stores</h3>
                <table style={styles.dataTable}>
                    <thead>
                        <tr style={styles.tableHeaderRow}>
                            <th style={styles.tableHeaderCell}>ID</th>
                            <th style={styles.tableHeaderCell}>Store Name</th>
                            <th style={styles.tableHeaderCell}>City</th>
                            <th style={styles.tableHeaderCell}>Assigned Partner(s)</th>
                            <th style={styles.tableHeaderCell}>Empty Bottles</th>
                        </tr>
                    </thead>
                    <tbody>
                        {storesList.map(store => (
                            <tr key={store.id} style={styles.tableRow}>
                                <td style={styles.tableCell}>{store.id}</td>
                                <td style={styles.tableCell}>{store.store_name}</td>
                                <td style={styles.tableCell}>{store.city}</td>
                                <td style={styles.tableCell}>{store.partner_name || 'Unassigned'}</td>
                                <td style={styles.tableCell}>{store.empty_bottles_count || 0}</td>
                            </tr>
                        ))}
                         {storesList.length === 0 && (
                            <tr style={styles.tableRow}><td colSpan="5" style={{...styles.tableCell, textAlign: 'center'}}>{loading ? 'Loading...' : 'No stores found.'}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );

    // RENDER PARTNERS TAB
    const renderPartners = () => {
        return (
            <div style={styles.contentArea}>
                <h2 style={styles.pageTitle}>{channelName.toUpperCase()} Partners ({partnersList.length})</h2>
                
                <div style={styles.tableCard}>
                    <h3 style={styles.cardTitle}>List of Partners</h3>
                    <table style={styles.dataTable}>
                        <thead>
                            <tr style={styles.tableHeaderRow}>
                                <th style={styles.tableHeaderCell}>Full Name</th>
                                <th style={styles.tableHeaderCell}>Email</th>
                                <th style={styles.tableHeaderCell}>Mobile</th>
                                <th style={styles.tableHeaderCell}>Stores Managed</th>
                                <th style={styles.tableHeaderCell}>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {partnersList.map(partner => (
                                <tr key={partner.id} style={styles.tableRow}>
                                    <td style={styles.tableCell}>{partner.full_name}</td>
                                    <td style={styles.tableCell}>{partner.email}</td>
                                    <td style={styles.tableCell}>{partner.mobile_number || 'N/A'}</td>
                                    <td style={styles.tableCell}>
                                        <span style={{fontWeight: 'bold'}}>
                                            {partner.stores?.map(s => s.store_name).join(', ') || '0'}
                                        </span>
                                    </td>
                                    <td style={styles.tableCell}>{partner.status || 'Active'}</td>
                                </tr>
                            ))}
                             {partnersList.length === 0 && (
                                <tr style={styles.tableRow}><td colSpan="5" style={{...styles.tableCell, textAlign: 'center'}}>{loading ? 'Loading...' : 'No partners found.'}</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    // RENDER CREATE PARTNER TAB
    const renderUnassignedOrders = () => (
        <div style={styles.contentArea}>
            <h2 style={{...styles.pageTitle, borderLeftColor: '#D32F2F'}}>🚨 Orphaned Orders (No DM Assigned)</h2>
            <div style={styles.tableCard}>
                <table style={styles.dataTable}>
                    <thead style={styles.tableHeaderRow}>
                        <tr>
                            <th style={styles.tableHeaderCell}>Order ID</th>
                            <th style={styles.tableHeaderCell}>Store</th>
                            <th style={styles.tableHeaderCell}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orphanedOrders.map(o => (
                            <tr key={o.id} style={styles.tableRow}>
                                <td style={styles.tableCell}>#{o.id}</td>
                                <td style={styles.tableCell}>{o.customerName}</td>
                                <td style={styles.tableCell}>
                                    <button style={{...styles.actionButton, backgroundColor: '#1565C0'}} onClick={() => setCurrentTab('stores')}>
                                        Go to Stores to Assign DM
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    // RENDER COMPLAINTS TAB (WITH RESOLVE BUTTON)
    const renderComplaints = () => (
  <div style={styles.contentArea}>
    <h2 style={styles.pageTitle}>
      {channelName.toUpperCase()} Complaints ({channelComplaints.length})
    </h2>

    <div style={styles.tableCard}>
      <h3 style={styles.cardTitle}>Complaints Assigned to This Channel</h3>

      <table style={styles.dataTable}>
        <thead>
          <tr style={styles.tableHeaderRow}>
            <th style={styles.tableHeaderCell}>ID</th>
            <th style={styles.tableHeaderCell}>Subject</th>
            <th style={styles.tableHeaderCell}>Description</th>
            <th style={styles.tableHeaderCell}>Raised By</th>
            <th style={styles.tableHeaderCell}>Store</th>
            <th style={styles.tableHeaderCell}>Status</th>
            <th style={styles.tableHeaderCell}>Created At</th>
            <th style={styles.tableHeaderCell}>Actions</th>
          </tr>
        </thead>

        <tbody>
          {channelComplaints.length === 0 ? (
            <tr style={styles.tableRow}>
              <td colSpan="8" style={{ ...styles.tableCell, textAlign: "center" }}>
                No complaints for this channel.
              </td>
            </tr>
          ) : (
            channelComplaints.map((c) => (
              <tr key={c.id} style={styles.tableRow}>
                <td style={styles.tableCell}>{c.id}</td>

                <td style={styles.tableCell}>{c.subject}</td>

                <td style={styles.tableCell}>
                  {c.description?.length > 60
                    ? `${c.description.substring(0, 60)}...`
                    : c.description}

                  {c.photo_url && (
                    <div style={{ marginTop: "8px" }}>
                      <a
                        href={`${API_BASE_URL}/${c.photo_url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          ...styles.actionButton,
                          backgroundColor: "#6c757d",
                          textDecoration: "none",
                          display: "inline-block",
                        }}
                      >
                        📷 View Image
                      </a>
                    </div>
                  )}
                </td>

                <td style={styles.tableCell}>
                  {c.created_by?.full_name || "Unknown User"}
                </td>

                <td style={styles.tableCell}>
                  {c.store?.store_name || c.store_id || "N/A"}
                </td>

                <td style={styles.tableCell}>
                  <span
                    style={{
                      ...styles.statusBadge,
                      backgroundColor: c.status === "pending" ? "#EF6C00" : "#4CAF50",
                    }}
                  >
                    {backendToUiStatus(c.status)}
                  </span>
                </td>

                <td style={styles.tableCell}>
                  {c.created_at ? new Date(c.created_at).toLocaleString() : "-"}
                </td>

                <td style={styles.tableCell}>
                  {c.status === "pending" ? (
                    <button
                      style={{ ...styles.actionButton, backgroundColor: "#1565C0" }}
                      onClick={() => handleResolveClick(c)}
                      disabled={resolvingComplaint}
                    >
                      Resolve
                    </button>
                  ) : (
                    <span style={{ fontWeight: "600", color: "#4CAF50" }}>
                      ✅ Resolved
                    </span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);




   const renderContent = () => {
        if (loading) {
            return <p style={styles.loadingText}>Loading {channelName.toUpperCase()} data...</p>;
        }
        switch (currentTab) {
            case 'dashboard':
                return renderDashboard();
            case 'orders':
                return renderOrders();
            case 'stores':
                return renderStores();
            case 'partners':
                return renderPartners();
            case 'createPartner':
                return renderCreatePartner();
            case 'complaints':
                return renderComplaints();
            case 'reports':
                return (
                    <div style={styles.contentArea}>
                        <h2 style={styles.pageTitle}>Reports Management</h2>

                        {/* --- Dual View Tab Switcher --- */}
                        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                            <button
                                style={{
                                    ...styles.button,
                                    width: 'auto',
                                    backgroundColor: reportsTab === "monthly" ? '#4CAF50' : '#ccc'
                                }}
                                onClick={() => setReportsTab("monthly")}
                            >
                                Monthly PDF Reports
                            </button>
                            <button
                                style={{
                                    ...styles.button,
                                    width: 'auto',
                                    backgroundColor: reportsTab === "operational" ? '#4CAF50' : '#ccc'
                                }}
                                onClick={() => setReportsTab("operational")}
                            >
                                Delivery Reports
                            </button>
                        </div>

                        {reportsTab === "monthly" ? (
                            <>
                                {/* --- Section 1: Available Monthly Reports (Super Admin Style) --- */}
                                <div style={styles.tableCard}>
                                    <h3 style={{ ...styles.cardTitle, borderBottom: '1px solid #eee' }}>
                                        Available Monthly Reports ({reports.length})
                                    </h3>
                                    <table style={styles.dataTable}>
                                        <thead>
                                            <tr style={{ ...styles.tableHeaderRow, backgroundColor: '#1A2A44' }}>
                                                <th style={styles.tableHeaderCell}>ID</th>
                                                <th style={styles.tableHeaderCell}>Report Name</th>
                                                <th style={styles.tableHeaderCell}>Month</th>
                                                <th style={styles.tableHeaderCell}>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {reports.length === 0 ? (
                                                <tr style={styles.tableRow}>
                                                    <td colSpan="4" style={{ ...styles.tableCell, textAlign: 'center', padding: '30px' }}>
                                                        No PDF reports available for this channel.
                                                    </td>
                                                </tr>
                                            ) : (
                                                reports.map((r) => (
                                                    <tr key={r.id} style={styles.tableRow}>
                                                        <td style={styles.tableCell}>#{r.id}</td>
                                                        <td style={{ ...styles.tableCell, fontWeight: '600' }}>
                                                            {r.report_file ? r.report_file.split('/').pop() : `Analysis_Report_${r.id}.pdf`}
                                                        </td>
                                                        <td style={styles.tableCell}>{formatReportMonth(r.report_date)}</td>
                                                        <td style={styles.tableCell}>
                                                            <button
                                                                style={{
                                                                    ...styles.actionButton,
                                                                    backgroundColor: '#1565C0',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '8px'
                                                                }}
                                                                onClick={() => handleReportDownload(r.id)}
                                                            >
                                                                <span>👁️</span> View PDF
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        ) : (
                            /* --- Section 2: System Operational Reports --- */
                            <div style={styles.tableCard}>
                                <Reports />
                            </div>
                        )}
                    </div>
                );
            case 'unassignedOrders':
                return renderUnassignedOrders();
            default:
                return renderDashboard();
        }
    };

    return (
        <div style={styles.dashboardLayout}>
            <Sidebar currentTab={currentTab} onSelectTab={handleSelectTab} channelName={channelName} />
            
            <main style={styles.mainPanel}>
                <header style={styles.topHeader}>
                    <h1 style={styles.headerTitle}>{channelName.toUpperCase()} Management Portal</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <span style={{ fontWeight: '600', color: '#555', fontSize: '14px' }}>
                            Admin User: {channelName}
                        </span>
                        <button style={styles.logoutButton} onClick={handleLogout}>Logout</button>
                    </div>
                </header>
                <div style={styles.mainContentArea}>
                    {renderContent()}
                </div>
            </main>

            {/* Global Complaint Modal */}
            <ComplaintResolutionModal
                isVisible={showResolveModal}
                onClose={handleCloseModal}
                onSubmit={handleComplaintResolveSubmit}
                complaint={selectedComplaint}
                solutionText={solutionText}
                setSolutionText={setSolutionText}
                isLoading={resolvingComplaint}
            />
        </div>
    );
};


// --- Styles (Updated for modern look) ---
const styles = {
    dashboardLayout: { display: 'flex', minHeight: '100vh', width: '100vw', backgroundColor: '#F4F6F8', fontFamily: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" },
    
    // Sidebar
    sidebar: { width: '240px', backgroundColor: '#1A2A44', color: '#ECF0F1', padding: '20px 0', display: 'flex', flexDirection: 'column', boxShadow: '2px 0 10px rgba(0,0,0,0.1)', zIndex: 10, },
    sidebarHeader: { padding: '0 20px 25px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '15px', },
    sidebarHeaderTitle: { fontSize: '24px', fontWeight: '800', color: '#00A896', margin: 0, },
    sidebarNav: { flexGrow: 1, padding: '0 10px', },
    sidebarItem: { display: 'flex', alignItems: 'center', padding: '12px 15px', borderRadius: '6px', marginBottom: '6px', backgroundColor: 'transparent', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', transition: 'background-color 0.2s ease, color 0.2s ease', fontSize: '15px', color: '#BDC3C7', },
    sidebarItemActive: { backgroundColor: '#4CAF50', color: '#FFFFFF', fontWeight: '700', },
    sidebarIcon: { fontSize: '18px', marginRight: '12px', },
    sidebarText: { color: 'inherit', },

    // Header and Main Content
    mainPanel: { flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    topHeader: { backgroundColor: '#FFFFFF', padding: '15px 30px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E0E0E0', flexShrink: 0 },
    headerTitle: { fontSize: '22px', fontWeight: '600', color: '#333', margin: 0 },
    logoutButton: { padding: '8px 16px', backgroundColor: '#E74C3C', color: '#FFFFFF', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' },
    mainContentArea: { flexGrow: 1, padding: '20px 30px', overflowY: 'auto', backgroundColor: '#F4F6F8' },
    loadingText: { textAlign: 'center', fontSize: '18px', marginTop: '50px', color: '#6B7280', },
    contentArea: {},
    pageTitle: { fontSize: '28px', fontWeight: '700', color: '#333', marginBottom: '30px', borderLeft: '5px solid #00A896', paddingLeft: '15px' },
    
    // KPI Cards
    kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '30px' },
    statCard: { borderRadius: '10px', padding: '20px', display: 'flex', alignItems: 'center', gap: '15px', boxShadow: '0 2px 6px rgba(0,0,0,0.08)', cursor: 'pointer', transition: 'transform 0.2s ease', minHeight: '80px' },
    statIcon: { fontSize: '32px' },
    statContent: { flex: 1 },
    statValue: { fontSize: '24px', fontWeight: 'bold', margin: '0' },
    statLabel: { fontSize: '13px', color: 'rgba(0,0,0,0.7)', margin: '0' },
    
    // Tables and Forms
    tableCard: { backgroundColor: '#FFFFFF', borderRadius: '10px', boxShadow: '0 2px 6px rgba(0,0,0,0.08)', overflow: 'hidden', marginBottom: '30px', },
    cardTitle: { fontSize: '20px', fontWeight: '600', color: '#333', padding: '20px', borderBottom: '1px solid #EEE', margin: 0 },
    dataTable: { width: '100%', borderCollapse: 'collapse', },
    tableHeaderRow: { backgroundColor: '#4CAF50', color: '#FFFFFF', textAlign: 'left', },
    tableHeaderCell: { padding: '15px 20px', fontWeight: '600', fontSize: '14px', },
    tableRow: { borderBottom: '1px solid #F0F2F5', },
    tableCell: { padding: '12px 20px', color: '#444', fontSize: '14px', },
    actionButton: { padding: '8px 12px', borderRadius: '4px', border: 'none', color: '#FFFFFF', cursor: 'pointer', fontSize: '13px', fontWeight: '500', transition: 'background-color 0.2s ease', },
    statusBadge: { padding: '4px 10px', borderRadius: '12px', color: '#FFFFFF', fontWeight: 'bold', fontSize: '11px', display: 'inline-block', minWidth: '60px', textAlign: 'center', textTransform: 'uppercase' },

    formCard: { backgroundColor: '#FFFFFF', borderRadius: '10px', padding: '30px', boxShadow: '0 2px 6px rgba(0,0,0,0.08)', marginBottom: '30px', },
    form: { display: 'flex', flexDirection: 'column', gap: '10px', },
    textInput: { width: '100%', padding: '12px 15px', borderRadius: '6px', border: '1px solid #DCE0E6', fontSize: '16px', color: '#333', outline: 'none', boxSizing: 'border-box', },
    button: { padding: '12px 20px', borderRadius: '6px', border: 'none', color: '#FFFFFF', fontWeight: '600', cursor: 'pointer', fontSize: '16px', transition: 'background-color 0.2s ease', width: '100%', textTransform: 'uppercase', letterSpacing: '0.5px', },

    // Modal Styles
    modalStyles: {
        backdrop: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
        },
        modal: {
            backgroundColor: '#FFFFFF',
            padding: '30px',
            borderRadius: '12px',
            width: '450px',
            maxWidth: '90%',
            boxShadow: '0 8px 20px rgba(0, 0, 0, 0.2)',
        },
        title: {
            fontSize: '20px',
            fontWeight: '600',
            color: '#333',
            marginBottom: '15px',
            borderBottom: '2px solid #EEE',
            paddingBottom: '10px'
        },
        textarea: {
            width: '100%',
            padding: '10px',
            borderRadius: '6px',
            border: '1px solid #DCE0E6',
            fontSize: '15px',
            resize: 'vertical',
            marginBottom: '20px',
            outline: 'none',
            boxSizing: 'border-box'
        },
        actions: {
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
        },
        cancelButton: {
            padding: '10px 18px',
            borderRadius: '6px',
            border: '1px solid #CCC',
            backgroundColor: '#F5F5F5',
            color: '#333',
            cursor: 'pointer',
            fontWeight: '600',
        },
        submitButton: {
            padding: '10px 18px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: '#4CAF50',
            color: '#FFFFFF',
            fontWeight: '600',
            cursor: 'pointer',
        }
    },
    modalSubtitle: {
        fontSize: '14px',
        color: '#6B7280',
        marginBottom: '8px',
        textAlign: 'left',
    },
};

export default ChannelAdminDashboard;