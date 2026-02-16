import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { API_BASE_URL } from './config';
import QrReader from "react-qr-reader-es6";
import Reports from './pages/Reports'; 

 
import Modal from "react-modal";




// We are temporarily removing chart imports to focus on UI structure,
// but they can be re-added if you reinstall the chart library.

// --- Configuration ---

const BOTTLE_PRICE = 42;

// --- Helper Functions ---
const backendToUiStatus = (s) => {
  if (s === 'pending') return 'Pending';
  if (s === 'in_progress' || s === 'accepted') return 'In Transit';
  if (s === 'delivered_pending_confirmation') return 'Awaiting Confirmation';
  if (s === 'delivered_confirmed' || s === 'delivered') return 'Delivered';
  if (s === 'cancelled') return 'Cancelled';
  return 'Pending';
};

// FIX: Helper to ensure the report link is an absolute URL
const getAbsoluteReportUrl = (filePath) => {
    if (!filePath) return '#';
    
    // If the path already includes the protocol, return it directly
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        return filePath;
    }
    // If it's a relative path (e.g., /files/report.pdf), prepend the base URL
    // We assume all paths returned by the backend need the base URL
    return `${API_BASE_URL}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
};

const mapComplaint = (c) => {
    const raisedBy = c.created_by?.role === 'partner' ? 'Partner' : 'Delivery Partner';
    return {
        id: String(c.id),
        subject: c.subject,
        description: c.description,
        raisedBy: raisedBy,
        date: new Date(c.created_at),
        status: backendToUiStatus(c.status),
        solution: c.solution,
    };
};

const mapOrderData = (apiData) => {
    if (!apiData) return [];
    return apiData.map(item => ({
        id: String(item.id),
        bottles: parseInt(item.order_details, 10),
        status: backendToUiStatus(item.status),
        orderDate: new Date(item.created_at),
        isPartnerOrder: !!item.partner_id,
        partnerName: item.partner ? item.partner.full_name : 'N/A',
        customerName: item.store ? item.store.store_name : 'Customer',
    }));
};

const exportToExcel = (data, fileName) => {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    XLSX.writeFile(wb, `${fileName}.xlsx`);
};

// --- Reusable Components ---

// UPDATED StatCard to correctly handle hover state using React Hooks
const StatCard = ({ label, value, icon, bgColor, textColor, onPress, unit = '' }) => {
    const [isHovered, setIsHovered] = useState(false);

    const cardStyle = useMemo(() => ({
        ...styles.statCard, 
        backgroundColor: bgColor,
        transform: isHovered ? 'translateY(-3px)' : 'translateY(0)',
        boxShadow: isHovered ? '0 10px 20px rgba(0,0,0,0.1)' : styles.statCard.boxShadow,
    }), [bgColor, isHovered]);

    return (
        <div
            style={cardStyle}
            onClick={onPress}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div style={{...styles.statIcon, color: textColor}}>{icon}</div>
            <div style={styles.statContent}>
                <p style={{ ...styles.statValue, color: textColor }}>
                    {value}
                    {unit && <span style={{ fontSize: '0.6em', opacity: 0.8, marginLeft: '5px' }}>{unit}</span>}
                </p>
                <p style={styles.statLabel}>{label}</p>
            </div>
        </div>
    );
};


// SidebarItem remains the same
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

const Sidebar = ({ currentTab, onSelectTab }) => (
    <aside style={styles.sidebar}>
        <div style={styles.sidebarHeader}>
            <h2 style={styles.sidebarHeaderTitle}>AquaTrack</h2>
        </div>
        <nav style={styles.sidebarNav}>
            <SidebarItem label="Dashboard" icon="🏠" name="dashboard" active={currentTab === 'dashboard'} onSelect={onSelectTab} />
            <SidebarItem label="My Orders" icon="📦" name="myOrders" active={currentTab === 'myOrders'} onSelect={onSelectTab} />
            <SidebarItem label="Place Order" icon="🛒" name="placeOrder" active={currentTab === 'placeOrder'} onSelect={onSelectTab} />
            <SidebarItem label="Complaints" icon="💬" name="complaints" active={currentTab === 'complaints'} onSelect={onSelectTab} />
            <SidebarItem label="Empty Bottles" icon="♻️" name="emptyBottles" active={currentTab === 'emptyBottles'} onSelect={onSelectTab} />
            <SidebarItem label="Test Reports" icon="📄" name="testReports" active={currentTab === 'testReports'} onSelect={onSelectTab} />
            <SidebarItem label="Analytics" icon="📊" name="analytics" active={currentTab === 'analytics'} onSelect={onSelectTab} />
        </nav>
    </aside>
);

// --- Main Component ---
const PartnerDashboard = () => {
    const [currentTab, setCurrentTab] = useState('dashboard');
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    const [bottlesToOrder, setBottlesToOrder] = useState('');
    const [orderAmount, setOrderAmount] = useState(0);
    const [partnerStoreId, setPartnerStoreId] = useState(null);

    const [myOrders, setMyOrders] = useState([]);
    const [totalOrders, setTotalOrders] = useState(0);
    const [pendingOrders, setPendingOrders] = useState(0);
    const [deliveredOrders, setDeliveredOrders] = useState(0);
    const [emptyBottleCount, setEmptyBottleCount] = useState(0);
    // 🧴 Empty Bottles State (Used for list if API existed, but count is calculated locally)
    
    const [isScannerOpen, setIsScannerOpen] = useState(false);
    const [scannedQr, setScannedQr] = useState("");


    const [reports, setReports] = useState([]);
    const [reportsLoading, setReportsLoading] = useState(true);

    const [newComplaints, setNewComplaints] = useState(0);
    const [pendingDeliveryComplaints, setPendingDeliveryComplaints] = useState(0);
    const [pendingYourComplaints, setPendingYourComplaints] = useState(0);

    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [filteredOrders, setFilteredOrders] = useState([]);

    const [newComplaintSubject, setNewComplaintSubject] = useState('');
    const [newComplaintDescription, setNewComplaintDescription] = useState('');
    const [complaintsRaised, setComplaintsRaised] = useState([]);
    const [complaintsAssigned, setComplaintsAssigned] = useState([]);

    const [todayOrders, setTodayOrders] = useState(0);
    const [deliveredToday, setDeliveredToday] = useState(0);
    const [deliveredThisMonth, setDeliveredThisMonth] = useState(0);
    const [lastFiveOrders, setLastFiveOrders] = useState([]); // NEW state for Recent Activity
    const [reportsTab, setReportsTab] = useState("monthly");


    // --- QR MODAL STATES ---
    const [isQRModalOpen, setIsQRModalOpen] = useState(false);
    const [scannedQRCode, setScannedQRCode] = useState("");
    const [manualQRCode, setManualQRCode] = useState("");
    const [qrError, setQrError] = useState(null);


    // 🟢 NEW DATA AGGREGATION FOR CHART 🟢
    const getMonthlyOrderData = useMemo(() => {
        const monthlyData = {};
        
        myOrders.forEach(order => {
            if (order.status !== 'Delivered') return; // Only count delivered orders for revenue

            const revenue = order.bottles * BOTTLE_PRICE;
            
            const monthKey = order.orderDate.toISOString().slice(0, 7); // YYYY-MM
            
            if (!monthlyData[monthKey]) {
                monthlyData[monthKey] = {
                    month: order.orderDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                    totalRevenue: 0,
                    totalBottles: 0,
                };
            }
            monthlyData[monthKey].totalRevenue += revenue;
            monthlyData[monthKey].totalBottles += order.bottles;
        });

        // Convert object into a sorted array and limit to last 6 months
        return Object.keys(monthlyData)
            .sort()
            .slice(-6) 
            .map(key => monthlyData[key]);
    }, [myOrders]);
    
    // 🟢 ADD SECURE DOWNLOAD HANDLER 🟢
    const handleReportDownload = async (reportId) => {
        const accessToken = localStorage.getItem('partner_token');
        if (!accessToken) {
            alert("Authentication required to download file. Please log in again.");
            navigate('/login/partner');
            return;
        }

        setLoading(true);

        try {
            // Use axios to make the authenticated request, expecting a binary file (blob)
            const response = await axios.get(
                `${API_BASE_URL}/reports/reports/download/${reportId}`,
                {
                    headers: { 'Authorization': `Bearer ${accessToken}` },
                    responseType: 'blob', // IMPORTANT: Handle response as binary data
                }
            );

            if (response.status === 200) {
                // Create a blob URL and temporary link to trigger download
                const blob = new Blob([response.data], { type: response.headers['content-type'] });
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                
                // Using ID and current date for filename
                const filename = `Report_${reportId}_${new Date().toISOString().slice(0, 10)}.pdf`;

                link.href = url;
                link.setAttribute('download', filename);
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.URL.revokeObjectURL(url);
                
            } else {
                throw new Error(`Server returned status ${response.status}.`);
            }
        } catch (error) {
            console.error('Download failed:', error.response?.data || error.message);
            
            // Improved error handling to read JSON response from Blob
            if (error.response && error.response.data instanceof Blob) {
                const reader = new FileReader();
                reader.onload = function() {
                    try {
                        const errorJson = JSON.parse(reader.result);
                        alert(`Download Error: ${errorJson.detail || 'File access denied.'}`);
                    } catch (e) {
                        alert('Download failed: Cannot read server error message. Check console.');
                    }
                };
                reader.readAsText(error.response.data);
            } else {
                alert('File download failed. Check console for network/server status.');
            }

        } finally {
            setLoading(false);
        }
    };


// --- DELETED: fetchEmptyBottles function is removed, as its logic is now local. ---


// ======================
// 🔹 Use Effect (Token Check + Data Fetch)
// ======================
useEffect(() => {
  const checkTokenAndFetchData = async () => {
    setLoading(true);
    const token = localStorage.getItem("partner_token");

    if (!token) {
      alert("Session Expired: Please log in again.");
      navigate("/login/partner");
      setLoading(false);
      return;
    }

    // Fetch all relevant data
    fetchData(token);
    fetchComplaints(token);
    fetchReports(token);
    
    setLoading(false);
  };

  checkTokenAndFetchData();
}, [navigate]);


    const fetchData = async (token) => {
    try {
        const storesResponse = await axios.get(`${API_BASE_URL}/partners/partners/me/stores`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });

        if (storesResponse.status === 401) {
            alert('Session Expired: Your session has expired. Please log in again.');
            handleLogout();
            return;
        }

        const storesData = storesResponse.data;
        if (storesData.length > 0) {
            setPartnerStoreId(storesData[0].id);
        } else {
            console.warn('Store information missing for partner.');
        }

        const ordersResponse = await axios.get(`${API_BASE_URL}/partner/orders/me`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });

        const ordersData = ordersResponse.data;

        const formattedOrders = (ordersData || []).map((order) => ({
            id: order.id.toString(),
            bottles: parseInt(order.order_details, 10),
            status: order.status === "delivered_pending_confirmation" ? "Awaiting Confirmation" : backendToUiStatus(order.status),
            orderDate: new Date(order.created_at),
            customerName: order.store?.store_name || "Store",
            partnerName: order.partner ? order.partner.full_name : "Partner",
            deliveryPhotoUrl: order.delivery_photo_url ? `${API_BASE_URL}${order.delivery_photo_url}` : null,

            // 🟢 Updated Mapping for Dual Confirmation
            bottlesDelivered: order.bottles_delivered || 0, 
            emptyBottlesCollected: order.empty_bottles_collected || 0, 
            confirmedBottles: order.confirmed_bottles || 0,
            confirmedEmptyBottles: order.confirmed_empty_bottles || 0, // Store confirmed value
            confirmationRemarks: order.confirmation_remarks || "",
        }));

        setMyOrders(formattedOrders);
        setFilteredOrders(formattedOrders);

        // -------------------------------------------------------------
        // 🟢🟢 FIX: FETCH EMPTY BOTTLES COUNT FROM DEDICATED INVENTORY API 🟢🟢
        // This replaces the inaccurate local sum.
        const emptyBottleResponse = await axios.get(
            `${API_BASE_URL}/bottle/partner/me/empty-bottles`,
            {
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        // ✅ Extract NUMBER safely
        const totalEmptyBottles = Number(
            emptyBottleResponse?.data?.pending_empty_bottles ?? 0
        );

        // ✅ State is now ALWAYS a number
        setEmptyBottleCount(totalEmptyBottles); // ⬅️ This sets the KPI card correctly
        // -------------------------------------------------------------

        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();

        const todayOrdersCount = formattedOrders.filter(
            (order) => order.orderDate.toDateString() === today.toDateString()
        ).length;

        const deliveredTodayCount = formattedOrders.filter(
            (order) => order.status === 'Delivered' && order.orderDate.toDateString() === today.toDateString()
        ).length;

        const deliveredThisMonthCount = formattedOrders.filter(
            (order) => order.status === 'Delivered' && order.orderDate.getMonth() === currentMonth && order.orderDate.getFullYear() === currentYear
        ).length;

        // Sort orders to get the recent ones
        const sortedOrders = [...formattedOrders].sort((a, b) => b.orderDate - a.orderDate);
        setLastFiveOrders(sortedOrders.slice(0, 5));
        

        setTotalOrders(formattedOrders.length);
        setPendingOrders(formattedOrders.filter((o) => o.status === 'Pending' || o.status === 'In Transit').length);
        setDeliveredOrders(formattedOrders.filter((o) => o.status === 'Delivered').length);
        setTodayOrders(todayOrdersCount);
        setDeliveredToday(deliveredTodayCount);
        setDeliveredThisMonth(deliveredThisMonthCount);

    } catch (error) {
        console.error('API call failed:', error);
        alert('Data Fetch Error: Failed to fetch dashboard data. Please check your network and try again.');
    } finally {
        setLoading(false);
    }
};

    const fetchComplaints = async (token) => {
        try {
            const myComplaintsResponse = await axios.get(
                `${API_BASE_URL}/complaints/complaints/me`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );
            setComplaintsRaised(myComplaintsResponse.data);

            setPendingYourComplaints(
                myComplaintsResponse.data.filter(
                    (c) => c.status === "pending"
                ).length
            );
        } catch (error) {
            console.error(
                "Failed to fetch raised complaints:",
                error.response?.data || error.message
            );
            setComplaintsRaised([]);
            setPendingYourComplaints(0);
        }

        try {
            const assignedComplaintsResponse = await axios.get(
                `${API_BASE_URL}/complaints/complaints/assigned`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );
            setComplaintsAssigned(assignedComplaintsResponse.data);

            setNewComplaints(
                assignedComplaintsResponse.data.filter(
                    (c) => c.status === "pending"
                ).length
            );
            setPendingDeliveryComplaints(
                assignedComplaintsResponse.data.filter(
                    (c) => c.status === "pending"
                ).length
            );
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                console.log("No complaints assigned.");
                setComplaintsAssigned([]);
                setNewComplaints(0);
                setPendingDeliveryComplaints(0);
            } else {
                console.error(
                    "Failed to fetch assigned complaints:",
                    error.response?.data || error.message
                );
                setComplaintsAssigned([]);
                setNewComplaints(0);
                setPendingDeliveryComplaints(0);
            }
        }
    };

    const fetchReports = async (token) => {
        setReportsLoading(true);
        try {
            const response = await axios.get(`${API_BASE_URL}/reports/reports/list`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            setReports(response.data);
        } catch (error) {
            console.error('Failed to fetch reports:', error);
            alert('Error: Failed to load reports.');
            setReports([]);
        } finally {
            setReportsLoading(false);
        }
    };

    const handleLogout = () => {
        if (window.confirm('Are you sure you want to log out?')) {
            localStorage.removeItem('partner_token');
            navigate('/login');
        }
    };

    const handleSelectTab = (tab) => {
        setCurrentTab(tab);
    };

    const handleClearDates = () => {
        setStartDate('');
        setEndDate('');
    };

    useEffect(() => {
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            const filtered = myOrders.filter(order => {
                const orderDate = new Date(order.orderDate);
                // Compare dates
                return orderDate >= start && orderDate <= end;
            });
            setFilteredOrders(filtered);
        } else {
            setFilteredOrders(myOrders);
        }
    }, [startDate, endDate, myOrders]);

    const handleExportOrders = async () => {
    setLoading(true);
    try {
        const token = localStorage.getItem('partner_token');
        if (!token) {
            alert('Authentication failed: Please log in again.');
            navigate('/login/partner');
            return;
        }

        const response = await axios.get(
            `${API_BASE_URL}/partners/partners/me/orders/export-all`,
            {
                headers: { 'Authorization': `Bearer ${token}` },
            }
        );

        if (!response.data || response.data.length === 0) {
            alert('No Data: There are no orders to export.');
            return;
        }

        const ordersForExport = response.data.map((order) => {
            const delivered = order.bottles_delivered || 0;
            const collected = order.empty_bottles_collected || 0;
            const pendingEmpty = delivered - collected;

            return {
                'Order ID': order.id,
                'Bottles Ordered': order.order_details,
                'Delivered Bottles': delivered,
                'Empty Bottles Collected': collected,
                'Pending Empty Bottles': pendingEmpty,
                'Status': order.status,
                'Date': new Date(order.created_at).toLocaleDateString(),
                'Customer Name': order.store?.store_name || 'N/A',
            };
        });

        const fileName = `My_Orders_${new Date().toISOString().slice(0, 10)}`;
        exportToExcel(ordersForExport, fileName);

        alert('Success: Orders exported successfully!');

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error('API Error:', error.response?.data || error.message);
            alert(
                `Export Error: ${
                    error.response?.data.detail ||
                    'Failed to fetch orders for export. Please try again.'
                }`
            );
        } else if (error instanceof Error) {
            console.error('General Error:', error.message);
            alert(`Export Error: ${error.message}`);
        } else {
            console.error('Unknown Error:', error);
            alert('Export Error: An unexpected error occurred.');
        }
    } finally {
        setLoading(false);
    }
};

    const handleConfirmDelivery = async (orderId, confirmedBottles, confirmedEmptyBottles, remarks) => {
        const token = localStorage.getItem("partner_token");
        if (!token) {
            alert("Please log in again.");
            navigate("/login/partner");
            return;
        }

        try {
            const response = await axios.put(
                `${API_BASE_URL}/partners/partners/partner/orders/${orderId}/confirm-delivery`,
                {
                    confirmed_bottles: confirmedBottles || 0,
                    confirmed_empty_bottles: confirmedEmptyBottles || 0, // 🆕 Added this field
                    confirmation_remarks: remarks || "",
                },
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );

            if (response.status === 200) {
                alert("✅ Delivery confirmed successfully!");
                fetchData(token); // Refresh
            }
        } catch (error) {
            console.error("Confirm Error:", error.response?.data || error.message);
            alert(error.response?.data?.detail || "Failed to confirm delivery.");
        }
    };

    // 🟢 Handle successful QR scan
    const handleQRScan = (data) => {
        if (data) {
            setScannedQRCode(data);
            setManualQRCode(data);
            setIsQRModalOpen(false);
            alert(`✅ QR Scanned: ${data}`);
        }
    };

    // 🟠 Handle QR scanning error
    const handleQRError = (err) => {
        console.error("QR Scan Error:", err);
        setQrError("Unable to access camera. Please check permissions or try manual entry.");
    };

    // 🔵 Manually submit QR code
    const handleManualQRSubmit = () => {
        if (!manualQRCode.trim()) {
            alert("Please enter or scan a QR code.");
            return;
        }
        alert(`✅ QR submitted: ${manualQRCode}`);
        setIsQRModalOpen(false);
        setManualQRCode("");
    };



    const handleRaiseComplaint = async (e) => {
  e.preventDefault();

  if (!newComplaintSubject.trim() || !newComplaintDescription.trim()) {
    alert("Please fill all fields");
    return;
  }

  const token = localStorage.getItem("partner_token");
  if (!token) {
    alert("Session Expired. Please login again.");
    navigate("/login/partner");
    return;
  }

  if (!partnerStoreId) {
    alert("Store ID not found. Please refresh the page once.");
    return;
  }

  try {
    const formData = new FormData();
    formData.append("subject", newComplaintSubject.trim());
    formData.append("description", newComplaintDescription.trim());
    formData.append("store_id", String(partnerStoreId)); 

    const res = await axios.post(
      `${API_BASE_URL}/complaints/complaints/submit`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      }
    );

    alert("✅ Complaint submitted successfully!");
    setNewComplaintSubject("");
    setNewComplaintDescription("");
    fetchComplaints(token);

  } catch (error) {
    console.error("Complaint Submit Error:", error?.response?.data || error.message);

    alert(
      error?.response?.data?.detail ||
      JSON.stringify(error?.response?.data) ||
      "Failed to raise complaint"
    );
  }
};




    const handlePlaceOrder = async (e) => {
    e.preventDefault();
    const bottles = parseInt(bottlesToOrder, 10);
    const totalAmount = bottles * BOTTLE_PRICE;

    if (!partnerStoreId) {
        alert('Error: Store information is missing. Please try refreshing or logging in again.');
        return;
    }

    if (isNaN(bottles) || bottles <= 0) {
        alert('Error: Please enter a valid number of bottles.');
        return;
    }

    // 🟢 ADDED CONFIRMATION STEP 🟢
    const isConfirmed = window.confirm(
        `Are you sure you want to place an order for ${bottles} bottle(s)?`
    );

    if (!isConfirmed) {
        return; // Stop execution if the user clicks Cancel
    }
    // ----------------------------
    
    setLoading(true);
    try {
        const token = localStorage.getItem('partner_token');
        if (!token) {
            alert('Authentication failed: Please log in again.');
            navigate('/login/partner');
            return;
        }

        const apiEndpoint = `${API_BASE_URL}/partner/orders`;
        const response = await axios.post(apiEndpoint, {
            store_id: partnerStoreId,
            order_details: bottles.toString(),
            total_amount: totalAmount,
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
        });

        if (response.status !== 200 && response.status !== 201) {
            throw new Error(`Failed to place order: ${response.data.detail || response.statusText}`);
        }

        // Refresh data
        alert(`Success: Order for ${bottles} bottles placed successfully!`);
        setBottlesToOrder('');
        setOrderAmount(0);
        await fetchData(token);
        setCurrentTab('myOrders');
    } catch (error) {
        console.error(error);
        if (error instanceof Error) {
            alert(`Error: ${error.message}`);
        } else {
            alert('Error: An unknown error occurred.');
        }
    } finally {
        setLoading(false);
    }
};
    // Helper component to render recent activity items
    const RecentActivityItem = ({ order }) => (
        <div style={styles.activityItem}>
            <p style={styles.activityText}>
                Order **#{order.id}** for **{order.bottles} bottles**
            </p>
            <span style={{
                ...styles.statusBadge,
                backgroundColor: order.status === 'Delivered' ? '#34A853' : (order.status === 'Pending' ? '#F4B400' : '#4285F4'),
                color: '#FFFFFF',
                fontSize: '11px',
                fontWeight: 'bold',
                padding: '4px 8px',
                minWidth: '60px',
            }}>
                {order.status}
            </span>
        </div>
    );
    
    // 🟢 CHART COMPONENT PLACEHOLDER 🟢
    const MonthlyPerformanceChart = ({ data }) => {
        if (data.length === 0) {
            return (
                <div style={styles.chartPlaceholder}>
                    <p>No delivered orders data available for charting.</p>
                </div>
            );
        }
        
        const labels = data.map(d => d.month);
        const revenueData = data.map(d => d.totalRevenue);
        const bottleData = data.map(d => d.totalBottles);

        return (
            <div style={{ height: '350px', width: '100%' }}>
                {/* This div simulates the chart area. Install a chart library (like react-chartjs-2)
                  to render the chart below.
                */}
                <div style={styles.chartPlaceholder}>
                    <h4 style={{ color: '#1A2A44', margin: '5px 0' }}>Monthly Revenue Trend (Last {data.length} Months)</h4>
                    <p style={{marginBottom: 10, color: '#00A896', fontWeight: 'bold'}}>REVENUE VS. BOTTLE VOLUME</p>
                    {data.map((d, index) => (
                        <p key={index} style={{ margin: '3px 0', fontSize: '14px', color: '#333' }}>
                            **{d.month}**: **₹{d.totalRevenue.toLocaleString('en-IN')}** ({d.totalBottles} bottles)
                        </p>
                    ))}
                    <p style={{ marginTop: 20, fontSize: 12, color: '#888' }}>
                         (Chart Placeholder Area)
                    </p>
                </div>
            </div>
        );
    };

    // UPDATED renderDashboard to fit content neatly
    const renderDashboard = () => (
        <div style={styles.scrollContent}>
            <div style={styles.kpiRow}>
                {/* Top KPI Row (3-4 columns) */}
                <StatCard 
                    label="Total Orders" 
                    value={totalOrders.toString()} 
                    icon="📦" 
                    bgColor="#E6F4F1" // Teal/Green Base
                    textColor="#00A896" // Vibrant Teal
                    onPress={() => handleSelectTab('myOrders')} 
                />
                <StatCard 
                    label="Pending Orders" 
                    value={pendingOrders.toString()} 
                    icon="⏳" 
                    bgColor="#FFF7E6" // Yellow Base
                    textColor="#F4B400" // Yellow Accent
                    onPress={() => handleSelectTab('myOrders')} 
                />
                <StatCard 
                    label="Delivered Orders" 
                    value={deliveredOrders.toString()} 
                    icon="✅" 
                    bgColor="#E9F7EF" // Light Green Base
                    textColor="#34A853" // Green Accent
                    onPress={() => handleSelectTab('myOrders')} 
                />
                <StatCard 
                    label="Empty Bottles" 
                    value={emptyBottleCount.toString()} 
                    icon="♻️" 
                    bgColor="#E6F2FF" // Blue Base
                    textColor="#4285F4" // Blue Accent
                    onPress={() => handleSelectTab('emptyBottles')} 
                />
            </div>

            {/* Main Content Area: Sales/Performance (Wide) and Recent Activity (Narrow) */}
            <div style={styles.mainContentGrid}>
                
                {/* 1. Performance Card (Wide) */}
                <div style={styles.performanceCard}>
                    <h3 style={styles.sectionTitle}>Sales & Order Performance</h3>
                    {/* 🟢 Use the Chart Component here 🟢 */}
                    <MonthlyPerformanceChart data={getMonthlyOrderData} />
                </div>

                {/* 2. Recent Activity Card (Narrow) - Fixed Height */}
                <div style={styles.recentActivityCard}>
                    <h3 style={styles.sectionTitle}>Recent Activity (Orders)</h3>
                    <div style={styles.activityList}>
                        {lastFiveOrders.length === 0 ? (
                            <p style={{...styles.activityText, fontStyle: 'italic'}}>No recent orders to display.</p>
                        ) : (
                            lastFiveOrders.map(order => (
                                <RecentActivityItem key={order.id} order={order} />
                            ))
                        )}
                    </div>
                </div>

            </div>

            {/* Bottom KPI Row (Additional Metrics) */}
            <div style={styles.kpiRow}>
                <StatCard 
                    label="Today's Orders" 
                    value={todayOrders.toString()} 
                    icon="📅" 
                    bgColor="#E1F5FE" 
                    textColor="#0277BD" 
                    onPress={() => handleSelectTab('myOrders')} 
                />
                <StatCard 
                    label="Delivered Today" 
                    value={deliveredToday.toString()} 
                    icon="🚚" 
                    bgColor="#FCE4EC" 
                    textColor="#C2185B" 
                    onPress={() => handleSelectTab('myOrders')} 
                />
                <StatCard
                    label="New Complaints"
                    value={newComplaints.toString()}
                    icon="⚠️"
                    bgColor="#FFEBE6"
                    textColor="#E74C3C" 
                    onPress={() => handleSelectTab('complaints')}
                />
                <StatCard
                    label="Pending Your Complaints"
                    value={pendingYourComplaints.toString()}
                    icon="📝"
                    bgColor="#E9F5FF" 
                    textColor="#3498DB"
                    onPress={() => handleSelectTab('complaints')}
                />
            </div>
        </div>
    );

   const renderEmptyBottles = () => (
    <div style={styles.contentArea}>
        <h2 style={styles.pageTitle}>🧴 Empty Bottles Collected (Confirmed)</h2>

        {/* This displays the cumulative sum of 'confirmedEmptyBottles' from all delivered orders */}
        <div style={{
            backgroundColor: '#E6F2FF',
            padding: '20px',
            borderRadius: '12px',
            marginBottom: '25px',
            border: '1px solid #4285F4',
            textAlign: 'center',
            maxWidth: '300px',
            boxShadow: '0 4px 10px rgba(66, 133, 244, 0.15)'
        }}>
            <h3 style={{ margin: 0, color: '#4285F4', fontSize: '16px', fontWeight: '600', textTransform: 'uppercase' }}>
                Total Empty Bottles
            </h3>
            <p style={{ fontSize: '42px', fontWeight: '800', color: '#1A2A44', margin: '5px 0 0 0' }}>
                {emptyBottleCount} 
            </p>
        </div>

        <div style={styles.tableCard}>
            <h3 style={styles.formTitle}>
                Summary Count ({emptyBottleCount})
            </h3>

            <p style={styles.noDataText}>
                The detailed list of individual bottle QRs is managed by the Delivery Partner system. This summary represents the **total confirmed empty bottles** collected from your store network, calculated from delivered orders.
            </p>
        </div>
    </div>
);



   const renderMyOrders = () => (
    <div style={styles.listContainer}>
        <h2 style={styles.pageTitle}>My Orders</h2>
        <div style={styles.formCard}>
            <div style={styles.datePickerRow}>
                <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={{ ...styles.textInput, flex: '0.45', marginBottom: 0 }}
                />
                <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    style={{ ...styles.textInput, flex: '0.45', marginBottom: 0 }}
                />
                {(startDate || endDate) && (
                    <button style={styles.clearButton} onClick={handleClearDates}>✕</button>
                )}
            </div>
        </div>
        <button style={{ ...styles.button, ...styles.exportButton }} onClick={handleExportOrders} disabled={loading}>
            {loading ? 'Exporting...' : 'Export All Orders'}
        </button>

        <div style={styles.itemCard}>
            {/* --- 🟢 Awaiting Confirmation Section --- */}
            {filteredOrders.some((o) => o.status === "Awaiting Confirmation") && (
                <div style={{ marginBottom: 30 }}>
                    <h3 style={styles.formTitle}>Awaiting Store Confirmation</h3>
                    {filteredOrders
                        .filter((o) => o.status === "Awaiting Confirmation")
                        .map((order) => (
                            <div key={order.id} style={{ ...styles.itemCard, background: "#fff7ed", border: "1px solid #f59e0b" }}>
                                
                                {/* Order Details & Proof */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: '15px' }}>
                                    <div style={{flex: 1, paddingRight: '10px'}}>
                                        <p style={{margin: '5px 0', fontSize: '16px'}}><strong>Order ID:</strong> #{order.id}</p>
                                        <p style={{margin: '5px 0'}}><strong>Date:</strong> {new Date(order.orderDate).toLocaleDateString()}</p>
                                        
                                        {/* Driver Reported Values Box */}
                                        <div style={{marginTop: '10px', padding: '10px', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderRadius: '8px'}}>
                                            <p style={{margin: '0 0 5px', fontSize: '13px', fontWeight: 'bold', color: '#B45309'}}>
                                                DRIVER REPORTED:
                                            </p>
                                            <p style={{margin: '2px 0', fontSize: '14px', color: '#333'}}>
                                                ⬇️ Filled Delivered: <strong>{order.bottlesDelivered}</strong>
                                            </p>
                                            <p style={{margin: '2px 0', fontSize: '14px', color: '#333'}}>
                                                ⬆️ Empty Collected: <strong>{order.emptyBottlesCollected}</strong>
                                            </p>
                                        </div>
                                    </div>

                                    {/* Proof Image Thumbnail (omitted for brevity) */}
                                </div>

                                {/* Confirmation Inputs */}
                                <div style={{ borderTop: '1px dashed #f59e0b', paddingTop: '15px' }}>
                                    <label style={{fontSize: '13px', fontWeight: '600', color: '#444', marginBottom: '5px', display: 'block'}}>Remarks (Optional)</label>
                                    <textarea
                                        placeholder="Any issues with the delivery?"
                                        style={{ ...styles.textInput, height: 60, marginBottom: '10px' }}
                                        onChange={(e) => (order._remarks = e.target.value)}
                                    />
                                    
                                    <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                        
                                        {/* Confirm Filled */}
                                        <div style={{flex: 1, minWidth: '120px'}}>
                                            <label style={{fontSize: '13px', fontWeight: '600', color: '#444', marginBottom: '5px', display: 'block'}}>Confirm Filled</label>
                                            <input
                                                type="number"
                                                min="0"
                                                placeholder="Filled"
                                                defaultValue={order.bottlesDelivered}
                                                style={{ ...styles.textInput, marginBottom: 0 }}
                                                onChange={(e) => (order._bottlesConfirmed = e.target.value)}
                                            />
                                        </div>

                                        {/* Confirm Empty */}
                                        <div style={{flex: 1, minWidth: '120px'}}>
                                            <label style={{fontSize: '13px', fontWeight: '600', color: '#444', marginBottom: '5px', display: 'block'}}>Confirm Empty</label>
                                            <input
                                                type="number"
                                                min="0"
                                                placeholder="Empty"
                                                defaultValue={order.emptyBottlesCollected}
                                                style={{ ...styles.textInput, marginBottom: 0 }}
                                                onChange={(e) => (order._emptyConfirmed = e.target.value)}
                                            />
                                        </div>

                                        {/* Confirm Button with Validation Logic */}
                                        <div style={{flex: 1, minWidth: '150px'}}>
                                            <button
                                                onClick={() => {
                                                    // 1. Get original driver values
                                                    const driverFilled = order.bottlesDelivered;
                                                    const driverEmpty = order.emptyBottlesCollected;

                                                    // 2. Get user inputs (or default to driver values if untouched)
                                                    const partnerFilledRaw = order._bottlesConfirmed !== undefined ? order._bottlesConfirmed : driverFilled;
                                                    const partnerEmptyRaw = order._emptyConfirmed !== undefined ? order._emptyConfirmed : driverEmpty;
                                                    
                                                    const partnerFilled = parseInt(partnerFilledRaw, 10);
                                                    const partnerEmpty = parseInt(partnerEmptyRaw, 10);
                                                    
                                                    // 3. MANDATORY VALIDATION: Check for valid non-negative integer input
                                                    const isFilledValid = Number.isInteger(partnerFilled) && partnerFilled >= 0;
                                                    const isEmptyValid = Number.isInteger(partnerEmpty) && partnerEmpty >= 0;
                                                    
                                                    if (!isFilledValid || !isEmptyValid) {
                                                        alert("Error: Please enter a valid non-negative whole number for both Filled and Empty bottles.");
                                                        return; // Stop execution
                                                    }
                                                    
                                                    // 4. Mismatch check (Existing Logic)
                                                    if (partnerFilled !== driverFilled || partnerEmpty !== driverEmpty) {
                                                        const proceed = window.confirm(
                                                            `⚠️ Mismatch Detected!\n\n` +
                                                            `Driver Reported: ${driverFilled} Filled, ${driverEmpty} Empty\n` +
                                                            `You Entered: ${partnerFilled} Filled, ${partnerEmpty} Empty\n\n` +
                                                            `Are you sure you want to confirm these different values?`
                                                        );
                                                        if (!proceed) return; // Stop execution if user cancels
                                                    }

                                                    // 5. Proceed with API call (now guaranteed to have valid numbers)
                                                    handleConfirmDelivery(order.id, partnerFilled, partnerEmpty, order._remarks);
                                                }}
                                                style={{ 
                                                    ...styles.button, 
                                                    backgroundColor: "#00A896", 
                                                    marginTop: 0, 
                                                    height: '46px', 
                                                    display: 'flex', 
                                                    alignItems: 'center', 
                                                    justifyContent: 'center' 
                                                }}
                                            >
                                                Confirm Delivery ✅
                                            </button>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        ))}
                </div>
            )}

            <button style={{ ...styles.button, backgroundColor: "#00A896", marginBottom: "15px" }} onClick={() => setIsQRModalOpen(true)}>
                📷 Scan QR / Enter Manually
            </button>

            <h3 style={styles.formTitle}>All Orders History</h3>
            <table style={styles.dataTable}>
                <thead>
                    <tr style={styles.tableHeaderRow}>
                        <th style={styles.tableHeaderCell}>Order ID</th>
                        <th style={styles.tableHeaderCell}>Date</th>
                        <th style={styles.tableHeaderCell}>Bottles</th>
                        <th style={styles.tableHeaderCell}>Status</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredOrders.map(order => (
                        <tr key={order.id} style={styles.tableRow}>
                            <td style={styles.tableCell}>{order.id}</td>
                            <td style={styles.tableCell}>{new Date(order.orderDate).toLocaleDateString()}</td>
                            <td style={styles.tableCell}>{order.bottles}</td>
                            <td style={styles.tableCell}>
                                <span style={{
                                    ...styles.statusBadge,
                                    backgroundColor: order.status === 'Delivered' ? '#00A896' :
                                        order.status === 'Awaiting Confirmation' ? '#f59e0b' :
                                            order.status === 'In Transit' ? '#F4B400' :
                                                order.status === 'Pending' ? '#E74C3C' :
                                                    '#34495E'
                                }}>
                                    {order.status}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);


    const hasPendingConfirmation = myOrders.some(
        (order) => order.status === "Awaiting Confirmation"
    );
    const renderPlaceOrder = () => (
        <div style={styles.scrollContent}>
            <div style={styles.formCard}>
                <h2 style={styles.pageTitle}>Place a New Order</h2>

                {/* ⚠️ BLOCK MESSAGE IF PREVIOUS ORDER NOT CONFIRMED */}
                {hasPendingConfirmation && (
                    <div
                        style={{
                            backgroundColor: "#FEF3C7",
                            border: "1px solid #F59E0B",
                            padding: "12px",
                            borderRadius: "8px",
                            marginBottom: "15px",
                            color: "#92400E",
                            fontWeight: "600"
                        }}
                    >
                        ⚠️ You have an order awaiting confirmation.
                        Please confirm the previous delivery before placing a new order.
                    </div>
                )}

                <form onSubmit={handlePlaceOrder}>
                    <label style={styles.formLabel}>Number of Bottles</label>

                    <input
                        type="number"
                        style={styles.textInput}
                        placeholder="Enter number of bottles"
                        value={bottlesToOrder}
                        onChange={(e) => {
                            const text = e.target.value;
                            setBottlesToOrder(text);
                            const numBottles = parseInt(text, 10);
                            if (!isNaN(numBottles) && numBottles > 0) {
                                setOrderAmount(numBottles * BOTTLE_PRICE);
                            } else {
                                setOrderAmount(0);
                            }
                        }}
                        disabled={hasPendingConfirmation}
                    />

                    <button
                        type="submit"
                        style={{
                            ...styles.button,
                            ...styles.createButton,
                            backgroundColor: hasPendingConfirmation ? "#9CA3AF" : "#4285F4",
                            cursor: hasPendingConfirmation ? "not-allowed" : "pointer"
                        }}
                        disabled={loading || hasPendingConfirmation}
                    >
                        {hasPendingConfirmation
                            ? "Confirm Previous Order First"
                            : loading
                                ? "Submitting..."
                                : "Submit Order"}
                    </button>
                </form>
            </div>
        </div>
    );

    const renderComplaints = () => (
    <div style={styles.scrollContent}>
        <div style={styles.cardContainer}>
            <h2 style={styles.pageTitle}>Complaints</h2>

            {/* Raise New Complaint */}
            <div style={styles.formCard}>
                <h3 style={styles.formTitle}>Raise a New Complaint</h3>
                <form onSubmit={handleRaiseComplaint}>
                    <input
                        style={styles.textInput}
                        placeholder="Complaint Subject"
                        value={newComplaintSubject}
                        onChange={(e) => setNewComplaintSubject(e.target.value)}
                        required
                    />

                    <textarea
                        style={{ ...styles.textInput, height: 100 }}
                        placeholder="Complaint Description"
                        value={newComplaintDescription}
                        onChange={(e) => setNewComplaintDescription(e.target.value)}
                        required
                    />

                    <button
                        type="submit"
                        style={{ ...styles.button, ...styles.createButton }}
                    >
                        Raise Complaint
                    </button>
                </form>
            </div>

            {/* Complaints Raised by Partner */}
            <div style={styles.complaintSection}>
                <h3 style={styles.formTitle}>Complaints Raised by You</h3>

                {complaintsRaised.length === 0 ? (
                    <p style={styles.noDataText}>No complaints raised by you.</p>
                ) : (
                    complaintsRaised.map((c) => (
                        <div
                            key={c.id}
                            style={{
                                ...styles.itemCard,
                                ...(c.status === "resolved" && styles.resolvedCard),
                            }}
                        >
                            <div style={styles.itemHeader}>
                                <p style={styles.itemTitle}>
                                    {c.subject}{" "}
                                    <span style={{ fontSize: "12px", color: "#6B7280" }}>
                                        (ID: {c.id})
                                    </span>
                                </p>

                                <span
                                    style={{
                                        ...styles.statusBadge,
                                        backgroundColor:
                                            c.status === "pending" ? "#E74C3C" : "#00A896",
                                    }}
                                >
                                    {c.status}
                                </span>
                            </div>

                            <p style={styles.itemDetails}>{c.description}</p>

                            {/* FIXED: Assigned To */}
                            <p style={styles.itemDetails}>
                                Raised to: <b>
                                    {c.assigned_channel_admin?.full_name ||
                                     c.assigned_admin?.full_name ||
                                     "Not Assigned"}
                                </b>
                            </p>

                            {c.solution && (
                                <p
                                    style={{
                                        ...styles.itemDetails,
                                        marginTop: 10,
                                        fontStyle: "italic",
                                        color: "#00A896",
                                        fontWeight: "bold",
                                    }}
                                >
                                    Solution: {c.solution}
                                </p>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Complaints Assigned To Partner (Delivery Partner view) */}
            <div style={styles.complaintSection}>
                <h3 style={styles.formTitle}>Complaints Assigned to You</h3>

                {complaintsAssigned.length === 0 ? (
                    <p style={styles.noDataText}>No complaints from delivery partners.</p>
                ) : (
                    complaintsAssigned.map((c) => (
                        <div
                            key={c.id}
                            style={{
                                ...styles.itemCard,
                                ...(c.status === "resolved" && styles.resolvedCard),
                            }}
                        >
                            <div style={styles.itemHeader}>
                                <p style={styles.itemTitle}>
                                    {c.subject}{" "}
                                    <span style={{ fontSize: "12px", color: "#6B7280" }}>
                                        (ID: {c.id})
                                    </span>
                                </p>

                                <span
                                    style={{
                                        ...styles.statusBadge,
                                        backgroundColor:
                                            c.status === "pending" ? "#E74C3C" : "#00A896",
                                    }}
                                >
                                    {c.status}
                                </span>
                            </div>

                            <p style={styles.itemDetails}>{c.description}</p>

                            {/* Raised by Partner */}
                            <p style={styles.itemDetails}>
                                Raised by: <b>{c.created_by?.full_name || "Unknown"}</b>
                            </p>

                            {c.solution && (
                                <p
                                    style={{
                                        ...styles.itemDetails,
                                        marginTop: 10,
                                        fontStyle: "italic",
                                        color: "#00A896",
                                        fontWeight: "bold",
                                    }}
                                >
                                    Solution: {c.solution}
                                </p>
                            )}
                        </div>
                    ))
                )}
            </div>

        </div>
    </div>
);





    const renderTestReports = () => (
    <div style={styles.contentArea}>
        <h2 style={styles.pageTitle}>Reports & Analytics</h2>

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
                    backgroundColor: reportsTab === "delivery" ? '#4CAF50' : '#ccc' 
                }}
                onClick={() => setReportsTab("delivery")}
            >
                Delivery Reports
            </button>
        </div>

        {reportsTab === "monthly" ? (
            <div style={styles.listContainer}>
                {reportsLoading ? (
                    <div style={{ ...styles.loadingContainer, minHeight: '300px' }}>
                        <p style={styles.loadingText}>Loading reports...</p>
                    </div>
                ) : reports.length === 0 ? (
                    <p style={styles.noDataText}>No monthly PDF reports available at this time.</p>
                ) : (
                    <div style={styles.tableCard}>
                        <h3 style={styles.formTitle}>Available PDF Reports ({reports.length})</h3>
                        <table style={styles.dataTable}>
                            <thead>
                                <tr style={{ ...styles.tableHeaderRow, backgroundColor: '#1A2A44' }}>
                                    <th style={styles.tableHeaderCell}>ID</th>
                                    <th style={styles.tableHeaderCell}>Month / Date</th>
                                    <th style={styles.tableHeaderCell}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reports.map((report) => (
                                    <tr key={report.id} style={styles.tableRow}>
                                        <td style={styles.tableCell}>#{report.id}</td>
                                        <td style={styles.tableCell}>
                                            {new Date(report.report_date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                        </td>
                                        <td style={styles.tableCell}>
                                            <button 
                                                onClick={() => handleReportDownload(report.id)} 
                                                style={{ 
                                                    ...styles.actionButton, 
                                                    backgroundColor: '#1565C0',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}
                                            >
                                                <span>👁️</span> View PDF
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        ) : (
            /* --- Operational / Delivery Reports View --- */
            <div style={styles.tableCard}>
                <Reports />
            </div>
        )}
    </div>
);

   const renderMainContent = () => {
  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <p style={styles.loadingText}>Loading...</p>
      </div>
    );
  }

  switch (currentTab) {
    case 'dashboard':
      return renderDashboard();
    case 'myOrders':
      return renderMyOrders();
    case 'placeOrder':
      return renderPlaceOrder();
    case 'complaints':
      return renderComplaints();
    case 'emptyBottles':
      return renderEmptyBottles();
    case 'testReports':
      return renderTestReports();
    case 'analytics': // ⭐ Case for the shared Reports component
                return <Reports />;
    default:
      return <p style={styles.errorText}>Something went wrong!</p>;
  }
};

return (
  <div style={styles.dashboardLayout}>
    <Sidebar currentTab={currentTab} onSelectTab={handleSelectTab} />
    <main style={styles.mainPanel}>
      <header style={styles.topHeader}>
        <h1 style={styles.headerTitle}>Partner Dashboard</h1>
        <button style={styles.headerLogoutButton} onClick={handleLogout}>
          <span style={{ marginRight: '8px' }}>🚪</span>Logout
        </button>
      </header>

      {/* --- MAIN CONTENT --- */}
      <div style={styles.mainContentArea}>
        {renderMainContent()}
      </div>

      {/* --- 🟢 QR SCANNER MODAL --- */}
      <Modal
        isOpen={isQRModalOpen}
        onRequestClose={() => setIsQRModalOpen(false)}
        contentLabel="QR Scanner"
        style={{
          overlay: { backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1000 },
          content: {
            width: "400px",
            margin: "auto",
            borderRadius: "10px",
            padding: "20px",
            background: "#fff",
            boxShadow: "0 8px 20px rgba(0,0,0,0.2)",
          },
        }}
      >
        <h3 style={{ textAlign: "center", marginBottom: "15px" }}>Scan QR Code</h3>

        <div style={{ textAlign: "center", marginBottom: "10px" }}>
          <QrReader
            delay={300}
            onError={handleQRError}
            onScan={handleQRScan}
            style={{ width: "100%", borderRadius: "8px" }}
          />
        </div>

        {qrError && <p style={{ color: "red", textAlign: "center" }}>{qrError}</p>}

        <p style={{ textAlign: "center", margin: "10px 0", fontWeight: "bold" }}>OR</p>

        <input
          type="text"
          placeholder="Enter QR Code manually"
          value={manualQRCode}
          onChange={(e) => setManualQRCode(e.target.value)}
          style={{ ...styles.textInput, marginBottom: "10px" }}
        />

        <button
          style={{ ...styles.button, backgroundColor: "#00A896", marginBottom: "10px" }}
          onClick={handleManualQRSubmit}
        >
          Submit
        </button>

        <button
          style={{ ...styles.button, backgroundColor: "#E74C3C" }}
          onClick={() => setIsQRModalOpen(false)}
        >
          Close
        </button>
      </Modal>
      {/* --- 🟢 END QR SCANNER MODAL --- */}
    </main>
  </div>
);
};


const styles = {
    // --- CORE LAYOUT AND HEADER STYLES ---
    dashboardLayout: {
        display: 'flex',
        minHeight: '100vh',
        backgroundColor: '#F7F9FB', 
        fontFamily: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif", 
    },
    sidebar: {
        width: '240px', 
        backgroundColor: '#1A2A44', 
        color: '#ECF0F1',
        padding: '20px 0',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '4px 0 10px rgba(0,0,0,0.15)', 
        zIndex: 10,
    },
    sidebarHeader: {
        padding: '0 20px 25px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        marginBottom: '15px',
    },
    sidebarHeaderTitle: {
        fontSize: '24px',
        fontWeight: '800', 
        color: '#00A896', 
        margin: 0,
    },
    sidebarNav: {
        flexGrow: 1,
        padding: '0 10px',
    },
    sidebarItem: {
        display: 'flex',
        alignItems: 'center',
        padding: '12px 15px',
        borderRadius: '8px', 
        marginBottom: '6px', 
        backgroundColor: 'transparent',
        border: 'none',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background-color 0.2s ease, color 0.2s ease',
        fontSize: '15px',
        color: '#BDC3C7', 
        // Hover effect for sidebar items is handled by the default browser button focus/hover states
    },
    // *** Sidebar Flashy Active State ***
    sidebarItemActive: {
        backgroundColor: '#00A896', // Full Vibrant Teal Fill
        color: '#FFFFFF',
        fontWeight: '700',
        boxShadow: '0 4px 8px rgba(0, 168, 150, 0.6)', // Bright, noticeable shadow
        transform: 'scale(1.02)', // Slight pop effect
    },
    sidebarIcon: {
        fontSize: '18px',
        marginRight: '12px',
    },
    sidebarText: {
        color: 'inherit', 
    },
    mainPanel: {
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
    },
    topHeader: {
        backgroundColor: '#FFFFFF',
        padding: '18px 30px', 
        boxShadow: '0 4px 8px rgba(0,0,0,0.08)', 
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #EAECEF',
    },
    headerTitle: {
        fontSize: '24px',
        fontWeight: '600',
        color: '#1A2A44',
        margin: 0,
    },
    headerLogoutButton: {
        padding: '10px 20px',
        backgroundColor: '#E74C3C', 
        color: '#FFFFFF',
        border: 'none',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '16px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        transition: 'background-color 0.2s ease, box-shadow 0.2s ease',
        boxShadow: '0 4px 6px rgba(231, 76, 60, 0.4)',
    },
    mainContentArea: {
        flexGrow: 1,
        padding: '25px 30px',
        overflowY: 'auto',
    },
    loadingContainer: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flexGrow: 1,
    },
    loadingText: {
        textAlign: 'center',
        fontSize: '18px',
        marginTop: '50px',
        color: '#6B7280',
    },

    // --- CARD AND KPI STYLES (FLASHY) ---
    pageTitle: {
        fontSize: '28px', 
        fontWeight: '700',
        color: '#1A2A44',
        marginBottom: '25px',
        borderLeft: '5px solid #4285F4', 
        paddingLeft: '15px',
        lineHeight: '1.2',
    },
    kpiRow: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', 
        gap: '20px', 
        marginBottom: '30px',
    },
    // *** KPI Card style - retained flashy appearance (now controlled by React state in StatCard component) ***
    statCard: {
        borderRadius: '12px', 
        padding: '25px', 
        display: 'flex',
        flexDirection: 'row', 
        alignItems: 'center',
        boxShadow: '0 6px 15px rgba(0,0,0,0.12)',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)', 
        minHeight: '100px',
        justifyContent: 'flex-start',
        border: 'none', 
    },
    statIcon: {
        fontSize: '32px', 
        marginRight: '15px', 
        backgroundColor: 'transparent',
    },
    statContent: {
        flex: 1,
        textAlign: 'left',
    },
    statValue: {
        fontSize: '30px', 
        fontWeight: '900', 
        margin: '0',
    },
    statLabel: {
        fontSize: '14px', 
        color: 'rgba(0,0,0,0.7)',
        margin: '0',
        fontWeight: '500',
    },
    
    // --- MAIN CONTENT GRID (FIXED HEIGHT) ---
    mainContentGrid: {
        display: 'grid',
        gridTemplateColumns: '3fr 1fr', 
        gap: '20px', 
        marginBottom: '30px',
    },
    performanceCard: {
        backgroundColor: '#fff',
        borderRadius: '12px',
        padding: '30px',
        boxShadow: '0 6px 15px rgba(0,0,0,0.1)',
        minHeight: '400px',
    },
    recentActivityCard: {
        backgroundColor: '#fff',
        borderRadius: '12px',
        padding: '30px',
        boxShadow: '0 6px 15px rgba(0,0,0,0.1)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '400px', 
    },
    chartPlaceholder: {
        padding: '40px',
        textAlign: 'center',
        color: '#6B7280',
        border: '1px dashed #E0E0E0',
        borderRadius: '8px',
        flexGrow: 1, 
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column', // Allow content to stack vertically
    },
    sectionTitle: {
        fontSize: '20px',
        fontWeight: '700',
        color: '#1A2A44',
        marginBottom: '15px',
        borderBottom: '2px solid #E0E0E0', 
        paddingBottom: '10px',
    },
    activityList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '15px',
        flexGrow: 1, 
        justifyContent: 'flex-start',
    },
    activityItem: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px dashed #DCE0E6',
        paddingBottom: '10px',
    },
    activityText: {
        fontSize: '14px',
        color: '#333',
        margin: 0,
    },

    // --- GENERAL ELEMENTS ---
    itemCard: {
        backgroundColor: '#fff',
        borderRadius: '12px', 
        padding: '25px',
        marginBottom: '20px',
        boxShadow: '0 6px 15px rgba(0,0,0,0.1)',
    },
    formCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: '12px',
        padding: '30px',
        boxShadow: '0 6px 15px rgba(0,0,0,0.1)',
        marginBottom: '30px',
    },
    dataTable: { width: '100%', borderCollapse: 'collapse', },
    tableHeaderRow: { backgroundColor: '#1A2A44', color: '#FFFFFF', textAlign: 'left', borderRadius: '12px 12px 0 0', overflow: 'hidden', },
    tableHeaderCell: { padding: '15px 20px', fontWeight: '600', fontSize: '14px', },
    tableRow: { borderBottom: '1px solid #ECEFF1', transition: 'background-color 0.15s ease', },
    tableCell: { padding: '12px 20px', color: '#333', fontSize: '14px', },
    formTitle: { fontSize: '22px', fontWeight: '600', color: '#1A2A44', marginBottom: '20px', borderBottom: '2px solid #F0F2F5', paddingBottom: '10px', },
    formLabel: { display: 'block', fontSize: '14px', color: '#555', marginBottom: '8px', fontWeight: '600', },
    textInput: { width: '100%', padding: '12px 15px', borderRadius: '8px', border: '1px solid #DCE0E6', fontSize: '16px', color: '#333', outline: 'none', marginBottom: '15px', boxSizing: 'border-box', transition: 'border-color 0.2s ease, box-shadow 0.2s ease', },
    button: { padding: '14px 25px', borderRadius: '8px', border: 'none', color: '#FFFFFF', fontWeight: '600', cursor: 'pointer', fontSize: '16px', transition: 'background-color 0.2s ease', width: '100%', textTransform: 'uppercase', letterSpacing: '0.5px', },
    createButton: { backgroundColor: '#4285F4', marginTop: '15px', boxShadow: '0 4px 6px rgba(66, 133, 244, 0.4)' },
    exportButton: { backgroundColor: '#00A896', marginTop: '10px', marginBottom: '20px', boxShadow: '0 4px 6px rgba(0, 168, 150, 0.4)' },
    statusBadge: { padding: '6px 12px', borderRadius: '20px', color: '#FFFFFF', fontWeight: 'bold', fontSize: '12px', display: 'inline-block', minWidth: '80px', textAlign: 'center', },
    emptyBottleCountText: { fontSize: '60px', fontWeight: 'bold', color: '#00A896', textAlign: 'center', padding: '10px 0', },
    totalAmountText: { fontSize: '32px', fontWeight: 'bold', color: '#4285F4', textAlign: 'center', marginTop: '10px', marginBottom: '25px', padding: '10px', backgroundColor: '#E6F2FF', borderRadius: '8px', },
    noDataText: { textAlign: 'center', color: '#6B7280', fontStyle: 'italic', padding: '30px', border: '1px dashed #DCE0E6', borderRadius: '12px', marginTop: '15px', },
    resolvedCard: { backgroundColor: '#E6F4F1', border: '1px solid #00A896', },
    datePickerRow: { display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '15px', },
    clearButton: { background: 'none', border: '1px solid #DCE0E6', color: '#E74C3C', fontWeight: 'bold', borderRadius: '8px', padding: '10px', cursor: 'pointer', fontSize: '16px', height: '44px', width: '44px', flexShrink: 0, transition: 'background-color 0.2s', },
    actionButton: { display: 'inline-block', padding: '8px 15px', borderRadius: '8px', backgroundColor: '#4285F4', color: '#FFFFFF', fontWeight: '600', fontSize: '13px', boxShadow: '0 2px 4px rgba(66, 133, 244, 0.4)' },
    // 🟢 NEW STYLE FOR GUIDANCE TEXT 🟢
    guidanceText: {
        fontSize: '12px',
        color: '#6B7280',
        fontStyle: 'italic',
        marginBottom: '20px',
        borderLeft: '3px solid #F4B400',
        paddingLeft: '10px',
    }
};

export default PartnerDashboard;