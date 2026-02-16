import React, { useState, useEffect, useMemo } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "./config";
import { QRCodeCanvas } from "qrcode.react";
import Reports from "./pages/Reports";

// --- Configuration ---

const BOTTLE_PRICE = 100; // Use BOTTLE_PRICE from this SuperAdmin file
// ⭐ FIX 1: Added 'CUSTOM' to the channel list
const ALL_CHANNELS = ["BLINKIT", "ZEPTO", "IBM", "GENERAL", "CUSTOM"]; 

// --- Helper Functions ---
const backendToUiStatus = (s) => {
  if (s === 'pending') return 'New';
  if (s === 'in_progress') return 'In Progress';
  if (s === 'delivered') return 'Delivered';
  return 'Resolved';
};


const ACTIVE_ORDER_STATUSES = [
  "Pending",
  "Accepted",
  "Assigned",
  "In Progress"
];

const statusColors = {
  Pending: "#FF9800",
  Accepted: "#1976D2",
  Assigned: "#6A1B9A",
  Delivered: "#2E7D32",
};


const isDelivered = (o) =>
  o.status?.toLowerCase() === "delivered";

const isActiveOrder = (o) =>
  ["pending", "accepted", "assigned", "in transit"].includes(
    o.status?.toLowerCase()
  );



// --- Reusable Collapsible Component for Segregation ---
const CollapsibleChannelSection = ({ title, children, defaultOpen = false, totalCount }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div style={styles.collapsibleContainer}>
            <button 
                onClick={() => setIsOpen(!isOpen)} 
                style={styles.collapsibleHeader}
            >
                <h3 style={styles.collapsibleTitle}>
                    {title} ({totalCount})
                </h3>
                <span style={styles.collapsibleIcon}>{isOpen ? '▼' : '►'}</span>
            </button>
            {isOpen && <div style={styles.collapsibleContent}>{children}</div>}
        </div>
    );
};
// --- Order Assignment Modal Component ---
const OrderAssignmentModal = ({ isVisible, onClose, order, approvedDeliveryPartners, onSubmit, selectedPartnerId, setSelectedPartnerId, modalStyles, styles, isLoading }) => {
    if (!isVisible || !order) return null;

    const handleAssign = (e) => {
        e.preventDefault();
        if (selectedPartnerId) {
            onSubmit(order.id, selectedPartnerId);
        } else {
            alert('Please select a delivery partner.');
        }
    };

    return (
        <div style={modalStyles.backdrop}>
            <div style={{ ...modalStyles.modal, maxHeight: '80vh', overflowY: 'auto' }}>
                <h3 style={modalStyles.title}>Assign Delivery Partner to Order #{order.id}</h3>
                <p style={styles.modalSubtitle}>Order Details: {order.bottles} bottles for {order.customerName}</p>

                <form onSubmit={handleAssign} style={styles.form}>
                    <label style={styles.reportLabel}>Select Delivery Partner:</label>
                    <select
                        style={styles.textInput}
                        value={selectedPartnerId}
                        onChange={(e) => setSelectedPartnerId(e.target.value)}
                        required
                        disabled={isLoading}
                    >
                        <option value="">-- Select Partner --</option>
                        {approvedDeliveryPartners.map(dp => (
                            <option key={dp.id} value={dp.id}>
                                {dp.full_name} ({dp.email})
                            </option>
                        ))}
                    </select>

                    <div style={modalStyles.actions}>
                        <button type="button" onClick={onClose} style={modalStyles.cancelButton} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" style={modalStyles.submitButton} disabled={isLoading || !selectedPartnerId}>
                            {isLoading ? 'Assigning...' : 'Assign Order'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};



const mapComplaint = (c) => {
  const storeNames = c.created_by?.stores?.map(s => s.store_name).join(', ') || 'N/A';
  
  // ⭐ CHANGE 1: Extract channel from the new 'store' object returned by the backend
  const complaintChannel = (
    c.store?.channel || 
    "GENERAL" 
  ).toUpperCase();
  // ⭐ END CHANGE 1

  return {
    id: String(c.id),
    subject: c.subject,
    description: c.description,
    customerName: c.created_by?.full_name || '—',
    role: `Partner at ${storeNames}` || '—',
    date: new Date(c.created_at),
    status: backendToUiStatus(c.status),
    photoUrl: c.photo_url || null, 
    // ⭐ CHANGE 2: Add the channel to the mapped complaint object
    channel: complaintChannel,
  };
};
const mapOrderData = (apiData) => {
  if (!apiData) return [];

  const normalizeStatus = (status) => {
    if (!status) return "Pending";
    const s = status.toLowerCase().replace("-", "_");

    if (s === "pending") return "Pending";
    if (s === "accepted") return "Accepted";
    if (s === "assigned_to_manager") return "Assigned";
    if (s === "assigned") return "Assigned";
    if (s === "in_transit") return "In Transit";
    if (s === "delivered" || s === "delivered_confirmed") return "Delivered";
    if (s === "cancelled") return "Cancelled";

    return status;
  };

  return apiData.map(item => {
    const store = item.store || null;
    const manager = store?.assigned_manager || null;

    return {
      // 🆔 Order
      id: String(item.id),
      bottles: parseInt(item.order_details, 10) || 0,
      status: normalizeStatus(item.status),
      orderDate: new Date(item.created_at),

      // 🏪 Store info
      storeId: store?.id || null,
      customerName: store?.store_name || "Unknown Store",
      city: store?.city || "N/A",

      // ⭐ DELIVERY MANAGER (FIXED)
      managerId: manager?.id || null,
      managerName: manager?.full_name || null,
      isManagerAssigned: !!manager,

      // 🚚 Delivery Partner
      deliveryPartnerId: item.delivery_person_id || null,
      deliveryPartnerName: item.delivery_person
        ? item.delivery_person.full_name
        : null,

      // 🤝 Partner order
      isPartnerOrder: !!item.partner_id,
      partnerId: item.partner_id || null,
      partnerName: item.partner
        ? item.partner.full_name
        : null,

      // 🏷 Channel
      channel: (store?.channel || item.channel || "GENERAL").toUpperCase(),
    };
  });
};




const formatReportMonth = (dateString) => {
    if (!dateString) return 'N/A';
    
    const parts = dateString.split('-'); 
    if (parts.length < 2) return dateString;

    try {
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1; 
        const date = new Date(year, month, 1); 
        
        return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch (e) {
        return 'Invalid Date Format';
    }
};

// --- Reusable Components ---
const StatCard = ({ label, value, icon, bgColor, textColor, onPress }) => (
  <div style={{ ...styles.statCard, backgroundColor: bgColor, color: textColor }} onClick={onPress}>
    <div style={styles.statIcon}>{icon}</div>
    <div style={styles.statContent}>
      <p style={styles.statValue}>{value}</p>
      <p style={styles.statLabel}>{label}</p>
    </div>
  </div>
);

const SidebarItem = ({ label, icon, name, active, onSelect, isUrgent }) => (
  <button
    style={{ 
      ...styles.sidebarItem, 
      ...(active ? styles.sidebarItemActive : {}),
      // Apply Red alert styling if isUrgent is true
      ...(isUrgent ? { borderLeft: '5px solid #ff4d4f', backgroundColor: '#fff1f0' } : {}) 
    }}
    onClick={() => onSelect(name)}
  >
    <span style={styles.sidebarIcon}>{icon}</span>
    <span style={{ 
      ...styles.sidebarText, 
      ...(active ? styles.sidebarTextActive : {}),
      ...(isUrgent ? { color: '#cf1322', fontWeight: 'bold' } : {}) 
    }}>
      {label}
    </span>
    {isUrgent && <span style={{ marginLeft: 'auto', fontSize: '14px' }}>🚨</span>}
  </button>
);

/* -----------------------------------------------------------
   SIDEBAR: Corrected to pass orphanedOrders logic
----------------------------------------------------------- */
const Sidebar = ({ currentTab, onSelectTab, orphanedOrdersCount = 0 }) => (
  <aside style={styles.sidebar}>
    <div style={styles.sidebarHeader}>
      <p style={styles.sidebarHeaderTitle}>AquaTrack</p>
    </div>

    <nav style={styles.sidebarNav}>
      <SidebarItem label="Dashboard" icon="📊" name="dashboard" active={currentTab === 'dashboard'} onSelect={onSelectTab} />
      
      {/* ⭐ CRITICAL FIX: Ensure isUrgent is linked to orphanedOrdersCount */}
      <SidebarItem
        label="Unassigned Orders"
        icon="🚫"
        name="unassignedOrders"
        active={currentTab === 'unassignedOrders'}
        onSelect={onSelectTab}
        isUrgent={orphanedOrdersCount > 0}
      />


      <SidebarItem label="Orders" icon="📋" name="orders" active={currentTab === 'orders'} onSelect={onSelectTab} />
      <SidebarItem
        label="Create Store Manager"
        icon="🤝"
        name="createPartner"
        active={currentTab === 'createPartner'}
        onSelect={onSelectTab}
      />

      <SidebarItem
        label="Store Managers List"
        icon="👥"
        name="myPartners"
        active={currentTab === 'myPartners'}
        onSelect={onSelectTab}
      />
      <SidebarItem label="Delivery Partner" icon="🚚" name="deliveryPartners" active={currentTab === 'deliveryPartners'} onSelect={onSelectTab} />
      <SidebarItem label="Complaints" icon="⚠️" name="complaints" active={currentTab === 'complaints'} onSelect={onSelectTab} />
      <SidebarItem label="Reports" icon="📝" name="reports" active={currentTab === 'reports'} onSelect={onSelectTab} />
      <SidebarItem label="QR" icon="📱" name="qrManagement" active={currentTab === 'qrManagement'} onSelect={onSelectTab} />
      <SidebarItem label="Active Stores" icon="🏬" name="activeStoresList" active={currentTab === 'activeStoresList'} onSelect={onSelectTab} />
      <SidebarItem label="Delivery Area Manager" icon="🗄️" name="deliveryManagers" active={currentTab === 'deliveryManagers'} onSelect={onSelectTab} />

      <SidebarItem 
        label="Channel Admin" 
        icon="🏪" 
        name="channelAdmin" 
        active={currentTab === 'channelAdmin'} 
        onSelect={onSelectTab} 
      />
    </nav>
  </aside>
);



// --- SolutionModal Component ---
const SolutionModal = ({ isVisible, onClose, onSubmit, complaintId, solutionText, setSolutionText, isLoading, modalStyles }) => {
    if (!isVisible) return null;
    return (
        <div style={modalStyles.backdrop}>
            <div style={modalStyles.modal}>
                <h3 style={modalStyles.title}>Resolve Complaint #{complaintId}</h3>
                <form onSubmit={onSubmit}>
                    <textarea
                        style={modalStyles.textarea}
                        placeholder="Enter your resolution message..."
                        value={solutionText}
                        onChange={(e) => setSolutionText(e.target.value)}
                        required
                        rows={5}
                        disabled={isLoading}
                    />
                    <div style={modalStyles.actions}>
                        <button type="button" onClick={onClose} style={modalStyles.cancelButton} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" style={modalStyles.submitButton} disabled={isLoading || !solutionText.trim()}>
                            {isLoading ? 'Resolving...' : 'Submit Resolution'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- QR Assigning Modal Component ---
const AssignBottleModal = ({ isVisible, onClose, selectedBottlesToAssign, approvedDeliveryPartners, onAssign, modalStyles }) => {
    const [selectedPartnerId, setSelectedPartnerId] = useState('');

    if (!isVisible) return null;

    const handleAssign = (e) => {
        e.preventDefault();
        if (selectedPartnerId) {
            onAssign(selectedPartnerId);
        } else {
            alert('Please select a delivery partner.');
        }
    };

    return (
        <div style={modalStyles.backdrop}>
            <div style={{ ...modalStyles.modal, maxHeight: '80vh', overflowY: 'auto' }}>
                <h3 style={modalStyles.title}>Assign Bottles to Partner</h3>
                <p style={styles.modalSubtitle}>Assigning {selectedBottlesToAssign.length} bottle(s)</p>

                <form onSubmit={handleAssign} style={styles.form}>
                    <label style={styles.reportLabel}>Select Delivery Partner:</label>
                    <select
                        style={styles.textInput}
                        value={selectedPartnerId}
                        onChange={(e) => setSelectedPartnerId(e.target.value)}
                        required
                    >
                        <option value="">-- Select Partner --</option>
                        {approvedDeliveryPartners.map(dp => (
                            <option key={dp.id} value={dp.id}>
                                {dp.full_name} ({dp.email})
                            </option>
                        ))}
                    </select>

                    <div style={modalStyles.actions}>
                        <button type="button" onClick={onClose} style={modalStyles.cancelButton}>
                            Cancel
                        </button>
                        <button type="submit" style={modalStyles.submitButton} disabled={!selectedPartnerId}>
                            Assign
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- DP Reassignment Modal Component (NEW) ---
// --- DP Reassignment Modal Component (NEW) ---
const ReassignDPModal = ({ isVisible, onClose, dp, managers, onMoveSubmit, styles, isLoading }) => {
    // Local state to track the selected new manager
    const [selectedManagerId, setSelectedManagerId] = useState('');

    useEffect(() => {
        // ⭐ FIX 1: Initialize selectedManagerId when the modal opens with the DP's current manager ID
        if (dp) {
            setSelectedManagerId(dp.assigned_manager_id ? String(dp.assigned_manager_id) : '0');
        } else {
            setSelectedManagerId('');
        }
    }, [dp]); // Recalculate whenever the DP object changes

    if (!isVisible || !dp) return null;

    const handleMove = (e) => {
        e.preventDefault();
        // Use the selectedManagerId from the dropdown state
        const managerId = selectedManagerId === '0' ? 0 : parseInt(selectedManagerId, 10);
        onMoveSubmit(dp.id, managerId);
    };

    const managersAndUnassign = [
        // Using '0' as string for consistency in <option value>
        { id: '0', full_name: "-- UNASSIGN (Remove Manager) --", assigned_area: "N/A" }, 
        // Ensure manager IDs are strings for <option value>
        ...managers.map(m => ({...m, id: String(m.id)})) 
    ];

    return (
        <div style={styles.modalStyles.backdrop}>
            <div style={{ ...styles.modalStyles.modal, maxHeight: '80vh', width: '450px', overflowY: 'auto' }}>
                <h3 style={styles.modalStyles.title}>Reassign Delivery Partner</h3>
                <p style={styles.modalSubtitle}>DP: {dp.full_name} (Current Manager ID: {dp.assigned_manager_id || 'None'})</p>

                <form onSubmit={handleMove} style={styles.form}>
                    <label style={styles.reportLabel}>Select New Manager:</label>
                    <select
                        style={styles.textInput}
                        value={selectedManagerId}
                        onChange={(e) => setSelectedManagerId(e.target.value)}
                        required
                        disabled={isLoading}
                    >
                        <option value="">-- Select Option --</option>
                        {managersAndUnassign.map(manager => (
                            <option key={manager.id} value={manager.id}>
                                {manager.full_name} {manager.id === '0' ? "(UNASSIGN)" : `(Area: ${manager.assigned_area})`}
                            </option>
                        ))}
                    </select>

                    <div style={styles.modalStyles.actions}>
                        <button type="button" onClick={onClose} style={styles.modalStyles.cancelButton} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" style={styles.modalStyles.submitButton} disabled={isLoading || selectedManagerId === ''}>
                            {isLoading ? 'Moving...' : 'Move/Unassign DP'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Manager Team List Component (NEW) ---
const ManagerTeamList = ({ manager, allDeliveryPartners, onReassignClick, styles }) => {
    const managerDps = allDeliveryPartners.filter(dp => 
        parseInt(dp.assigned_manager_id) === parseInt(manager.id)
    );

    if (managerDps.length === 0) {
        return (
            <div style={{ padding: '15px', background: '#fcfcfc', border: '1px dashed #DDD', borderRadius: 8, marginTop: 10 }}>
                <p style={{ margin: 0, color: '#DC3545', fontWeight: 'bold' }}>
                    No Delivery Partners currently assigned to {manager.full_name}.
                </p>
            </div>
        );
    }

    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ ...styles.dataTable, width: '100%', border: '1px solid #CCC' }}>
                <thead>
                    <tr style={{ backgroundColor: '#333', color: '#fff' }}>
                        <th style={{ ...styles.tableHeaderCell, padding: '8px 12px', fontSize: '13px' }}>DP Name</th>
                        <th style={{ ...styles.tableHeaderCell, padding: '8px 12px', fontSize: '13px' }}>Mobile</th>
                        <th style={{ ...styles.tableHeaderCell, padding: '8px 12px', fontSize: '13px' }}>City</th>
                        <th style={{ ...styles.tableHeaderCell, padding: '8px 12px', fontSize: '13px' }}>Status</th>
                        <th style={{ ...styles.tableHeaderCell, padding: '8px 12px', fontSize: '13px' }}>Action</th>
                    </tr>
                </thead>
                <tbody>
                    {managerDps.map(dp => (
                        <tr key={dp.id} style={styles.tableRow}>
                            <td style={{ ...styles.tableCell, padding: '8px 12px' }}>{dp.full_name}</td>
                            <td style={{ ...styles.tableCell, padding: '8px 12px' }}>{dp.mobile_number || 'N/A'}</td>
                            <td style={{ ...styles.tableCell, padding: '8px 12px' }}>{dp.city || 'N/A'}</td>
                            <td style={{ ...styles.tableCell, padding: '8px 12px' }}>
                                <span style={{ ...styles.activityStatusBadge, backgroundColor: dp.status === 'active' ? '#4CAF50' : '#FF9800' }}>
                                    {dp.status}
                                </span>
                            </td>
                            <td style={{ ...styles.tableCell, padding: '8px 12px' }}>
                                <button
                                    onClick={() => onReassignClick(dp)}
                                    style={{ ...styles.actionButton, backgroundColor: '#1565C0', padding: '6px 10px' }}
                                    disabled={dp.status !== 'active'}
                                >
                                    Move/Reassign
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
// --- Main Component ---
const SuperAdminDashboard = () => {
  const [currentTab, setCurrentTab] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const [dmName, setDmName] = useState("");
  const [dmEmail, setDmEmail] = useState("");
  const [dmPassword, setDmPassword] = useState("");
  const [dmMobile, setDmMobilenumber] = useState("");
  
  const [selectedStoreIdsDM, setSelectedStoreIdsDM] = useState([]);
  const [reports, setReports] = useState([]);


  // 📊 Reports tab selector
  const [reportsTab, setReportsTab] = useState("monthly");

  // 📄 Monthly Report States (REQUIRED)
  const [reportMonth, setReportMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadingReport, setUploadingReport] = useState(false);

  // 📄 Monthly report state (REQUIRED)


// DP Linking modal states


// Store selected DP id
const [selectedDPId, setSelectedDPId] = useState("");

  // --- Dashboard Data States ---
  const [totalOrders, setTotalOrders] = useState(0);
  const [customerOrdersCount, setCustomerOrdersCount] = useState(0);
  const [partnerOrdersCount, setPartnerOrdersCount] = useState(0);
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0);
  const [manualAssignmentOrders, setManualAssignmentOrders] = useState([]);
  const [totalActiveStores, setTotalActiveStores] = useState(0);
  const [totalVendors, setTotalVendors] = useState(0);
  const [totalDeliveryPartners, setTotalDeliveryPartners] = useState(0);
  const [dailyOrders, setDailyOrders] = useState(0);
  const [newComplaints, setNewComplaints] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [monthlyRevenue, setMonthlyRevenue] = useState(0);
  const [monthlyOrdersCount, setMonthlyOrdersCount] = useState(0);
  const [pendingDeliveryPartnersCount, setPendingDeliveryPartnersCount] =
    useState(0);
  const [channelAdminsList, setChannelAdminsList] = useState([]);
  const [deliveryManagers, setDeliveryManagers] = useState([]);
  const [isDPLinkingModalVisible, setIsDPLinkingModalVisible] = useState(false);
  const [managerToLink, setManagerToLink] = useState(null);
  const [isReassignModalVisible, setIsReassignModalVisible] = useState(false);
  const [dpToReassign, setDpToReassign] = useState(null);
  const [expandedManagerId, setExpandedManagerId] = useState(null);
 
  // 🌟 NEW KPIs 🌟
  const [dailyDeliveredOrders, setDailyDeliveredOrders] = useState(0);
  const [monthlyDeliveredOrders, setMonthlyDeliveredOrders] = useState(0);

  // --- BOTTLE KPIs STATES (Needed for Dashboard) ---
  const [freshBottlesWarehouse, setFreshBottlesWarehouse] = useState(0);
  const [emptyBottlesStores, setEmptyBottlesStores] = useState(0);

  // --- QR Management States ---
  const [generatedQrData, setGeneratedQrData] = useState(null);
  const [qrAssigning, setQrAssigning] = useState(false);
  const [selectedBottlesToAssign, setSelectedBottlesToAssign] = useState([]);
  const [unassignedBottles, setUnassignedBottles] = useState([]);
  

  const [isStoreDetailsModalVisible, setIsStoreDetailsModalVisible] = useState(false);
  const [selectedStoreForDetails, setSelectedStoreForDetails] = useState(null);


  const [isManageStoresModalOpen, setIsManageStoresModalOpen] = useState(false);
  const [selectedManagerForStores, setSelectedManagerForStores] = useState(null);

  const [selectedStoreIdsToAdd, setSelectedStoreIdsToAdd] = useState([]);
  const [selectedStoreIdsToRemove, setSelectedStoreIdsToRemove] = useState([]);

  

  
  const [loadingQR, setLoadingQR] = useState(false);


  const [newStoreName, setNewStoreName] = useState("");
  const [newStoreCity, setNewStoreCity] = useState("");
  const [newStoreAddress, setNewStoreAddress] = useState("");
  const [newStoreLat, setNewStoreLat] = useState("");
  const [newStoreLong, setNewStoreLong] = useState("");
  
  // ⭐ Store Creation Channel State
  const [newStoreChannel, setNewStoreChannel] = useState(ALL_CHANNELS[0]);
  const [newStoreCustomChannelName, setNewStoreCustomChannelName] = useState("");
  const [storeFilterCity, setStoreFilterCity] = useState("ALL");
  const [storeFilterChannel, setStoreFilterChannel] = useState("ALL");



  const [qrSummary, setQrSummary] = useState({});

  // ⭐ Channel Admin Form States
const [channelAdminName, setChannelAdminName] = useState("");
const [channelAdminEmail, setChannelAdminEmail] = useState("");
const [channelAdminPassword, setChannelAdminPassword] = useState("");
const [channelAdminChannel, setChannelAdminChannel] = useState("BLINKIT");











const cityOptions = [
    // --- NCR REGIONS (CRITICAL for Routing Fix) ---
    "HR-NCR",   // Haryana NCR Region (e.g., Gurgaon, Faridabad, Sonepat)
    "UP-NCR",   // Uttar Pradesh NCR Region (e.g., Noida, Ghaziabad, Meerut)
    "DL-NCR",   // Delhi National Capital Territory (if needed, or use "New Delhi")

    // --- Tier 1 Cities (Metros) ---
    "Mumbai",
    "Bengaluru",
    "Chennai",
    "Kolkata",
    "Hyderabad",
    
    // --- Tier 2 Cities (Expanded List) ---
    "Ahmedabad",
    "Pune",
    "Surat",
    "Jaipur", // Existing
    "Lucknow", // Existing
    "Kanpur", // Existing
    "Nagpur",
    "Visakhapatnam",
    "Bhopal",
    "Patna",
    "Ludhiana", // Existing
    "Amritsar", // Existing
    "Varanasi", // Existing
    "Agra", // Existing
    
    // --- Existing Cities (Retained for Individual City Assignment) ---
    "Delhi",
    "New Delhi",
    "Gurgaon",
    "Faridabad",
    "Noida",
    "Ghaziabad",
    "Sonipat",
    "Panipat",
    "Karnal",
    "Ambala",
    "Chandigarh",
    "Mohali",
    "Panchkula",
    "Aligarh",
    "Patiala",
];
  const AutocompleteCitySelect = ({ value, onChange, options }) => {
    const [search, setSearch] = useState("");

    const filtered = options.filter(city =>
        city.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div style={{ position: "relative", width: "100%" }}>
            <input
                style={styles.textInput}
                placeholder="Type to search city..."
                value={search || value}
                onChange={(e) => {
                    setSearch(e.target.value);
                    onChange(""); // reset selected city
                }}
            />

            {search && (
                <div
                    style={{
                        position: "absolute",
                        top: "100%",
                        left: 0,
                        right: 0,
                        maxHeight: "160px",
                        overflowY: "auto",
                        background: "white",
                        border: "1px solid #ddd",
                        zIndex: 999,
                        borderRadius: "4px"
                    }}
                >
                    {filtered.length === 0 && (
                        <div style={{ padding: 8, color: "#999" }}>
                            No results found
                        </div>
                    )}

                    {filtered.map((city) => (
                        <div
                            key={city}
                            style={{
                                padding: 8,
                                cursor: "pointer",
                                borderBottom: "1px solid #eee"
                            }}
                            onClick={() => {
                                onChange(city);
                                setSearch(city);
                            }}
                        >
                            {city}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};






  

const handleCreateChannelAdmin = async (e) => {
  e.preventDefault();

  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken") ||
    localStorage.getItem("partner_token");

  if (!token) {
    alert("Authentication token missing. Please login again.");
    navigate("/login/superadmin");
    return;
  }

  // ✅ Resolve final channel value
  const finalChannel =
    channelAdminChannel === "CUSTOM"
      ? customChannelName.trim().toUpperCase()
      : channelAdminChannel;

  if (!finalChannel) {
    alert("Please select or enter a valid channel.");
    return;
  }

  try {
    const body = {
      full_name: channelAdminName,
      email: channelAdminEmail,
      password: channelAdminPassword,
      channel: finalChannel,
      status: "active",
    };

    const response = await axios.post(
      `${API_BASE_URL}/partners/partners/superadmin/create-channel-admin`,
      body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    alert("Channel Admin created successfully!");

    // ✅ Add custom channel back into dropdown
    if (
      channelAdminChannel === "CUSTOM" &&
      customChannelName &&
      !allChannels.includes(finalChannel)
    ) {
      setAllChannels((prev) => [
        ...prev.filter((c) => c !== "CUSTOM"),
        finalChannel,
        "CUSTOM",
      ]);
    }

    // Reset form fields
    setChannelAdminName("");
    setChannelAdminEmail("");
    setChannelAdminPassword("");
    setCustomChannelName("");
    setChannelAdminChannel("GENERAL");

  } catch (error) {
    console.error("Error creating Channel Admin:", error);
    alert(
      error.response?.data?.detail ||
      "Failed to create Channel Admin"
    );
  }
};



  // --- QR Management Handlers ---
  const handleGenerateQR = async () => {
    try {
      setLoading(true);

      const token =
        accessToken ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('userToken') ||
        localStorage.getItem('partner_token');

      if (!token) {
        alert('Authentication Required. Please log in to access the dashboard.');
        navigate('/login/superadmin');
        return;
      }

      const res = await fetch(`${API_BASE_URL}/bottle/superadmin/generate-qr`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        // mirror the TSX error parsing
        let message = `Server error: ${res.status} ${res.statusText}`;
        try {
          const err = await res.json();
          if (Array.isArray(err.detail)) message = err.detail.map(d => d.msg).join('; ');
          else if (typeof err.detail === 'string') message = err.detail;
        } catch { }
        throw new Error(message);
      }

      const data = await res.json();
      setGeneratedQrData(data);
      alert('A new QR code has been generated and stored.');
      await fetchAllData();
    } catch (e) {
      console.error('Failed to generate QR:', e);
      alert(e.message || 'Failed to generate QR code.');
    } finally {
      setLoading(false);
    }
  };


  // --- Core Data States ---
  const [partners, setPartners] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [allDeliveryPartners, setAllDeliveryPartners] = useState([]);
  const [approvedDeliveryPartners, setApprovedDeliveryPartners] = useState([]);
  const [complaints, setComplaints] = useState([]);
  const [isSolutionModalVisible, setIsSolutionModalVisible] = useState(false);
  const [currentComplaintId, setCurrentComplaintId] = useState(null);
  const [solutionText, setSolutionText] = useState("");
  const [resolvingComplaint, setResolvingComplaint] = useState(false);
  const [bulkCount, setBulkCount] = useState(1);
  const [loadingBulk, setLoadingBulk] = useState(false);

  // --- Partner Details Modal ---
  const [isPartnerDetailsModalVisible, setIsPartnerDetailsModalVisible] =
    useState(false);
  const [selectedPartnerForDetails, setSelectedPartnerForDetails] =
    useState(null);


  // ⭐ NEW STATE: Holds ALL stores, irrespective of channel
  const [allStores, setAllStores] = useState([]);

    // ⭐ UNIQUE CITIES FROM STORES (DB-driven)
  const availableCities = useMemo(() => {
    const cities = allStores
      .map(store => store.city)
      .filter(Boolean); // remove null / undefined

    return [...new Set(cities)].sort();
  }, [allStores]);



  // --- Report Management States ---
  
  
// "monthly" | "delivery"

  
  // --- New Partner Creation Form States ---
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [stores, setStores] = useState([]);
  const [selectedStoreIds, setSelectedStoreIds] = useState([]);
  // ⭐ NEW STATE: Channel for the new Partner
  const [partnerChannel, setPartnerChannel] = useState(ALL_CHANNELS[0]); 
  // ⭐ NEW STATE: Custom Channel Input
  const [customChannelName, setCustomChannelName] = useState("");
  const [allChannels, setAllChannels] = useState(ALL_CHANNELS);
  const [newStoreId, setNewStoreId] = useState("");


  const [accessToken, setAccessToken] = useState(null);

  // 🌟 NEW STATES FOR DATE FILTERING IN ORDERS TAB 🌟
  const [ordersStartDate, setOrdersStartDate] = useState("");
  const [ordersEndDate, setOrdersEndDate] = useState("");
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [isOrderAssigningModalVisible, setIsOrderAssigningModalVisible] =
    useState(false);
  const [isAssignDMModalVisible, setIsAssignDMModalVisible] = useState(false);
  const [orderToAssignDM, setOrderToAssignDM] = useState(null);
  const [selectedDMId, setSelectedDMId] = useState("");
  const [orderToAssign, setOrderToAssign] = useState(null); // The Order object
  const [selectedDeliveryPartnerId, setSelectedDeliveryPartnerId] =
    useState("");

  // ✅ SINGLE SOURCE OF TRUTH = BACKEND
  const orphanedOrders = useMemo(() => {
    return manualAssignmentOrders || [];
  }, [manualAssignmentOrders]);




  // --- EFFECT: Update filtered orders whenever filters or data change ---
  useEffect(() => {
    let filtered = allOrders;

    if (ordersStartDate && ordersEndDate) {
      const start = new Date(ordersStartDate);
      const end = new Date(ordersEndDate);
      end.setHours(23, 59, 59, 999); // include the entire end date

      filtered = allOrders.filter((order) => {
        const orderDate = new Date(order.orderDate);
        return orderDate >= start && orderDate <= end;
      });
    }

    setFilteredOrders(filtered);
  }, [ordersStartDate, ordersEndDate, allOrders]);

  const handleClearDates = () => {
    setOrdersStartDate("");
    setOrdersEndDate("");
  };

  const fetchChannelAdmins = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/partners/partners/superadmin/list-channel-admins`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    setChannelAdminsList(response.data);  // ✔ Correct
  } catch (error) {
    console.error("Error loading channel admins", error);
  }
};

    // 🟢 NEW DATA AGGREGATION FOR CHART 🟢
   

    const getMonthlyOrderData = useMemo(() => {
        const monthlyData = {};
        
        // Use allOrders data available in component state
        allOrders.forEach(order => {
            // Only count delivered orders for sales/revenue charts
            if (order.status?.toLowerCase() !== 'delivered') return;

            const monthKey = order.orderDate.toISOString().slice(0, 7); // YYYY-MM
            const revenue = order.bottles * BOTTLE_PRICE;
            
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
    }, [allOrders]);
    
    // 🟢 CHART COMPONENT PLACEHOLDER 🟢
    const MonthlyPerformanceChart = ({ data }) => {
        if (data.length === 0) {
            return (
                <div style={styles.chartPlaceholder}>
                    <p>No delivered orders data available for charting.</p>
                </div>
            );
        }
        
        // This simulates the chart area with the calculated data points
        return (
            <div style={{ height: '350px', width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                <div style={styles.chartPlaceholder}>
                    <h4 style={{ color: '#1A2A44', margin: '5px 0' }}>Monthly Revenue Trend (Last {data.length} Months)</h4>
                    <p style={{marginBottom: 10, color: '#00796B', fontWeight: 'bold'}}>TOTAL REVENUE VS. VOLUME</p>
                    {data.map((d, index) => (
                        <p key={index} style={{ margin: '3px 0', fontSize: '14px', color: '#333' }}>
                            **{d.month}**: **₹{d.totalRevenue.toLocaleString('en-IN')}** ({d.totalBottles} bottles)
                        </p>
                    ))}
                    <p style={{ marginTop: 20, fontSize: 12, color: '#888' }}>
                        (Placeholder for Sales Chart)
                    </p>
                </div>
            </div>
        );
    };

    // --- API Fetching Functions (Resilient Logic) ---
const fetchAllData = async () => {
  setLoading(true);

  try {
    const token =
      localStorage.getItem("auth_token") ||
      localStorage.getItem("userToken") ||
      localStorage.getItem("partner_token");

    if (!token) {
      alert("Authentication Required. Please log in.");
      navigate("/login");
      return;
    }

    setAccessToken(token);

    const authHeaders = {
      headers: { Authorization: `Bearer ${token}` },
    };

    const userRole = localStorage.getItem("user_role") || "superadmin";

    // ----------------------------------
    // 🔗 API CALLS
    // ----------------------------------
    const promises = [
      axios.get(`${API_BASE_URL}/superadmin/orders/all`, authHeaders), // [0]
      axios.get(`${API_BASE_URL}/superadmin/orders/pending`, authHeaders), // [1]
      axios.get(`${API_BASE_URL}/partners/partners/list`, authHeaders), // [2]
      axios.get(`${API_BASE_URL}/partners/partners/superadmin/delivery-partners`, authHeaders), // [3]
      axios.get(`${API_BASE_URL}/bottle/superadmin/unassigned-bottles`, authHeaders), // [4]
      axios.get(`${API_BASE_URL}/complaints/complaints/assigned`, authHeaders), // [5]
      axios.get(`${API_BASE_URL}/bottle/superadmin/store-empty-counts`, authHeaders), // [6]
      axios.get(`${API_BASE_URL}/reports/reports/list`, authHeaders), // [7]

      userRole === "partner"
        ? axios.get(`${API_BASE_URL}/bottle/partner/me/empty-bottles`, authHeaders)
        : Promise.resolve({ data: { pending_empty_bottles: 0 } }), // [8]

      axios.get(`${API_BASE_URL}/store/list/all`, authHeaders), // [9]

      axios.get(`${API_BASE_URL}/partners/partners/superadmin/list-channel-admins`, authHeaders), // [10]
      axios.get(`${API_BASE_URL}/partners/partners/superadmin/list-delivery-managers`, authHeaders), // [11]
      axios.get(`${API_BASE_URL}/partners/partners/superadmin/orders/needs-manual-assignment`, authHeaders), // [12]
    ];

    const results = await Promise.allSettled(promises);

    const getData = (index) => {
      const res = results[index];
      if (res.status === "fulfilled") return res.value.data;

      console.warn(`API ${index} failed`, res.reason?.response?.data || res.reason);
      if (res.reason?.response?.status === 401) {
        throw new Error("Authentication Error");
      }
      return null;
    };

    // ----------------------------------
    // 📦 ORDERS
    // ----------------------------------
    const allOrdersData = getData(0);
    if (allOrdersData) {
      const mappedOrders = mapOrderData(allOrdersData);
      setAllOrders(mappedOrders);
      setFilteredOrders(mappedOrders);
      setTotalOrders(mappedOrders.length);
    }

    const pendingOrdersData = getData(1);
    if (pendingOrdersData) {
      setPendingOrdersCount(mapOrderData(pendingOrdersData).length);
    }

    // ----------------------------------
    // 📊 REPORTS
    // ----------------------------------
    const rawReports = getData(7);
    if (rawReports) {
      setReports(
        rawReports.map(r => ({
          id: r.id,
          filename: r.report_file ? r.report_file.split("/").pop() : `Report_${r.id}.pdf`,
          rawMonthYear: r.report_date || r.created_at,
          ...r,
        }))
      );
    }

    // ----------------------------------
    // 🧮 EMPTY BOTTLES (SUPERADMIN FIX)
    // ----------------------------------
    const storesDataWithCounts = getData(6) || [];

    // Map store_id → empty_bottles_count
    const emptyBottleMap = {};
    storesDataWithCounts.forEach(store => {
      emptyBottleMap[store.id] = store.empty_bottles_count || 0;
    });

    // ----------------------------------
    // 🏪 ALL STORES (MERGED DATA)
    // ----------------------------------
    const allStoresData = getData(9) || [];

    const mergedStores = allStoresData.map(store => ({
      ...store,
      empty_bottles_count: emptyBottleMap[store.id] ?? 0,
    }));

    setAllStores(mergedStores);
    setTotalActiveStores(mergedStores.length);

    // 🌍 Global Empty Bottles KPI
    const globalEmptyCount = mergedStores.reduce(
      (sum, s) => sum + (s.empty_bottles_count || 0),
      0
    );
    setEmptyBottlesStores(globalEmptyCount);

    if (mergedStores.length > 0) {
      setPartnerChannel(mergedStores[0].channel?.toUpperCase() || "");
    }

    // ----------------------------------
    // 👥 PARTNERS
    // ----------------------------------
    const partnersData = getData(2) || [];
    setPartners(partnersData);
    setTotalVendors(partnersData.length);

    const allDeliveryPartnersData = getData(3) || [];
    setAllDeliveryPartners(allDeliveryPartnersData);

    const deliveryManagersData = getData(11) || [];
    setDeliveryManagers(deliveryManagersData);

    // ----------------------------------
    // 🧑‍💼 CHANNEL ADMINS
    // ----------------------------------
    const channelAdminsData = getData(10) || [];
    setChannelAdminsList(channelAdminsData);

    // ----------------------------------
    // 🚚 MANUAL ASSIGNMENT
    // ----------------------------------
    const manualAssignmentData = getData(12);
    if (manualAssignmentData) {
      setManualAssignmentOrders(mapOrderData(manualAssignmentData));
    }

    // ----------------------------------
    // ♻️ UNASSIGNED BOTTLES
    // ----------------------------------
    const unassignedBottlesData = getData(4) || [];
    setUnassignedBottles(
      unassignedBottlesData.map(b => ({
        UUID: b.uuid,
        qr_code: b.qr_code,
      }))
    );

    // ----------------------------------
    // ⚠️ COMPLAINTS
    // ----------------------------------
    const complaintsData = getData(5) || [];
    setComplaints(complaintsData.map(mapComplaint));
    setNewComplaints(complaintsData.filter(c => c.status === "pending").length);

  } catch (error) {
    console.error("CRITICAL ERROR:", error);

    if (error.message.includes("Authentication")) {
      alert("Session expired. Please login again.");
      localStorage.clear();
      navigate("/login");
    } else {
      alert("Dashboard failed to load.");
    }
  } finally {
    setLoading(false);
  }
};

// 🔁 Run on load
useEffect(() => {
  fetchAllData();
}, []);




const fetchQrData = async () => {
  try {
    // ✅ FIX: Use the correct token keys from your login
    const token =
      localStorage.getItem('auth_token') ||
      localStorage.getItem('userToken') ||
      localStorage.getItem('partner_token') ||
      accessToken;

    if (!token) {
      console.error("QR data fetch skipped: No token found.");
      return; 
    }

    const headers = { Authorization: `Bearer ${token}` };

    // Fetch both summary and unassigned bottles at the same time
    const [summaryRes, unassignedRes] = await Promise.allSettled([
      axios.get(`${API_BASE_URL}/bottle/superadmin/summary`, { headers }),
      axios.get(`${API_BASE_URL}/bottle/superadmin/unassigned-bottles`, { headers }),
    ]);

    // Process summary
    if (summaryRes.status === 'fulfilled') {
        setQrSummary(summaryRes.value.data || {});
    } else {
        console.error("Failed to fetch QR summary:", summaryRes.reason);
    }
    
    // Process unassigned bottles
    if (unassignedRes.status === 'fulfilled') {
        const mappedBottles = (unassignedRes.value.data || []).map((bottle) => ({
                UUID: bottle.uuid,
                qr_code: bottle.qr_code,
            }));
            setUnassignedBottles(mappedBottles);
    } else {
        console.warn("Failed to fetch unassigned bottles:", unassignedRes.reason);
    }

  } catch (error) {
    console.error("Error in fetchQrData:", error);
  }
};

const handleExportOrdersToExcel = () => {
  if (filteredOrders.length === 0) {
    alert("No orders available to export.");
    return;
  }

  // ⭐ UPDATED HEADERS ⭐
  const headers = [
    "Order ID",
    "Customer/Store Name",
    "Is Partner Order",
    "Bottles Ordered",
    "Delivered Bottles",
    "Empty Bottles Collected",
    "Pending Empty Bottles",
    "Total Revenue (INR)",
    "Status",
    "Order Date & Time",
    "Delivery Partner",
  ];

  const csvData = filteredOrders.map(order => {
    // Order revenue
    const isDelivered = order.status?.toLowerCase() === 'delivered';
    const revenue = isDelivered ? order.bottles * BOTTLE_PRICE : 0;

    // ⭐ Empty bottle logic
    const delivered = order.bottles ?? 0;  // Admin sees bottles delivered as "bottles"
    const collected = order.empty_bottles_collected ?? 0;
    const pending = delivered - collected;

    // CSV escape helper
    const escape = (value) => `"${String(value).replace(/"/g, '""')}"`;

    const orderDateTime = `${order.orderDate.toLocaleDateString()} ${order.orderDate.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit', 
      hour12: true 
    })}`;

    return [
      escape(order.id),
      escape(order.customerName),
      escape(order.isPartnerOrder ? 'Yes' : 'No'),
      delivered,
      delivered,
      collected,
      pending,
      revenue,
      escape(order.status),
      escape(orderDateTime),
      escape(order.deliveryPartnerName),
    ].join(',');
  });

  const csvContent = [headers.join(','), ...csvData].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');

  const today = new Date().toISOString().slice(0, 10);
  const filename = `Aquatrack_Orders_${ordersStartDate || 'All'}_to_${ordersEndDate || 'All'}_${today}.csv`;

  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
};



  // ------------------------------------------
  // --- REPORT MANAGEMENT HANDLERS ---
  // ------------------------------------------

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      setSelectedFile(file);
    } else {
      alert('Please select a PDF file.');
      setSelectedFile(null);
    }
  };

  const handleApproveDeliveryPartner = async (partnerId) => {
    // Step 1: Get valid token (handles all key names)
    const token =
      accessToken ||
      localStorage.getItem('auth_token') ||
      localStorage.getItem('userToken') ||
      localStorage.getItem('partner_token');

    if (!token) {
      alert('Authentication token missing. Please login again.');
      navigate('/login/superadmin');
      return;
    }

    // Step 2: Confirm approval
    if (!window.confirm(`Are you sure you want to approve this Delivery Partner (ID: ${partnerId})?`))
      return;

    setLoading(true);
    try {
      // ⭐ FIX: Correct the API URL to match the documented backend endpoint structure.
      const response = await axios.patch(
        `${API_BASE_URL}/partners/partners/superadmin/delivery-partners/${partnerId}/approve`,
        { status: 'active' }, // Send the new status explicitly to ensure the DB update occurs
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      if (response.status === 200 || response.status === 204) {
        alert('✅ Delivery Partner approved successfully!');
        await fetchAllData(); // refresh
      } else {
        console.error('Unexpected response:', response.status, response.data);
        alert(`Unexpected server response: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Partner approval failed:', error.response?.data || error.message);
      if (error.message.includes('Network Error')) {
        alert('Network error: possible CORS issue.');
      } else if (error.response?.status === 401) {
        alert('Session expired. Please log in again.');
        navigate('/login/superadmin');
      } else {
        alert(`Failed to approve: ${error.response?.data?.detail || error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };
const handleApproveOrder = async (orderId) => {
  const token =
    accessToken ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('userToken') ||
    localStorage.getItem('partner_token');

  if (!token) {
    alert('Authentication token missing. Please log in again.');
    navigate('/login/superadmin');
    return;
  }

  if (!window.confirm(`Are you sure you want to approve Order #${orderId}?`)) {
    return;
  }

  setLoading(true);
  try {
    const response = await axios.patch(
      `${API_BASE_URL}/superadmin/orders/${orderId}/approve`, // ✅ fixed endpoint
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.status === 200 || response.status === 204) {
      alert(`✅ Order #${orderId} approved successfully!`);
      await fetchAllData(); // refresh the table
    } else {
      throw new Error(`Server responded with ${response.status}`);
    }
  } catch (error) {
    console.error('Order approval failed:', error.response?.data || error.message);
    alert(
      error.response?.data?.detail ||
        `Failed to approve order: ${error.message}`
    );
  } finally {
    setLoading(false);
  }
};


// ------------------------------------------
// --- ORDER ASSIGNMENT HANDLERS ---
const handleRouteOrderClick = (order) => {
  // 🛑 Safety check: order already has DM
  if (order.assigned_to_manager_id) {
    alert(`Order #${order.id} is already assigned to a Delivery Manager.`);
    return;
  }

  const token =
    accessToken ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('userToken') ||
    localStorage.getItem('partner_token');

  if (!token) {
    alert('Authentication token missing. Please log in.');
    navigate('/login/superadmin');
    return;
  }

  // ✅ Open Assign DM modal
  setOrderToAssignDM(order);
  setSelectedDMId('');
  setIsAssignDMModalVisible(true);
};


const handleAssignDMConfirm = async () => {
  if (!orderToAssignDM || !selectedDMId) {
    alert("Please select a Delivery Manager");
    return;
  }

  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken") ||
    localStorage.getItem("partner_token");

  if (!token) {
    alert("Authentication missing. Please login again.");
    return;
  }

  try {
    setLoading(true);

    await axios.patch(
      `${API_BASE_URL}/partners/partners/superadmin/orders/${orderToAssignDM.id}/assign-manager/${selectedDMId}`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );

    alert("✅ Delivery Manager assigned successfully");

    setIsAssignDMModalVisible(false);
    setOrderToAssignDM(null);
    setSelectedDMId("");

    fetchAllData(); // refresh unassigned + orders
  } catch (err) {
    console.error("Assign DM failed:", err.response?.data || err.message);
    alert(err.response?.data?.detail || "Failed to assign Delivery Manager");
  } finally {
    setLoading(false);
  }
};



const handleAddStore = async (e) => {
  e.preventDefault();

  const token = accessToken || localStorage.getItem("auth_token");

  if (!token) {
    alert("Authentication token missing.");
    navigate("/login/superadmin");
    return;
  }

  const finalChannel = (newStoreChannel || "GENERAL").toUpperCase().trim();

  if (!newStoreId || !newStoreName || !newStoreCity) {
    alert("Store ID, Store Name and City are required.");
    return;
  }

  try {
    setLoading(true);

    const body = {
      id: String(newStoreId).trim(),     // ✅ FIXED
      store_name: String(newStoreName).trim(),
      city: String(newStoreCity).trim(),
      address: String(newStoreAddress || "").trim(),
      latitude: newStoreLat ? parseFloat(newStoreLat) : null,
      longitude: newStoreLong ? parseFloat(newStoreLong) : null,
      channel: finalChannel,
    };

    console.log("✅ Sending Store Payload:", body);

    const res = await axios.post(`${API_BASE_URL}/store/create`, body, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    alert("✅ Store Created Successfully!");

    setNewStoreId("");
    setNewStoreName("");
    setNewStoreCity("");
    setNewStoreAddress("");
    setNewStoreLat("");
    setNewStoreLong("");

    await fetchAllData();
  } catch (err) {
    console.log("❌ Error adding store:", err?.response?.data || err.message);

    const msg =
      err?.response?.data?.detail?.[0]?.msg ||
      err?.response?.data?.detail ||
      "Failed to add store.";

    alert(msg);
  } finally {
    setLoading(false);
  }
};


const handleDeleteStore = async (storeId) => {
  const token = accessToken || localStorage.getItem("auth_token");
  if (!token) {
    alert("Authentication token missing.");
    navigate("/login/superadmin");
    return;
  }

  if (!window.confirm("Are you sure you want to delete this store?")) return;

  try {
    setLoading(true);
    const res = await axios.delete(`${API_BASE_URL}/store/${storeId}/delete`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 200 || res.status === 204) {
      alert("Store deleted successfully!");
      await fetchAllData();
    }
  } catch (err) {
    console.error("Delete failed:", err.response?.data || err.message);
    alert(err.response?.data?.detail || "Failed to delete store.");
  } finally {
    setLoading(false);
  }
};

// ------------------------------------------
// --- BOTTLE ASSIGNMENT HANDLER (Fix) ---
const handleAssignBottlesToPartner = async (deliveryPartnerId) => {
    const token =
      accessToken ||
      localStorage.getItem('auth_token') ||
      localStorage.getItem('userToken') ||
      localStorage.getItem('partner_token');

    if (!token) {
      alert('Authentication token not found. Please log in again.');
      navigate('/login/superadmin');
      return;
    }
    if (!selectedBottlesToAssign || selectedBottlesToAssign.length === 0) {
      alert('Please select at least one bottle to assign.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/bottle/superadmin/assign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          qr_codes: selectedBottlesToAssign,
          delivery_boy_id: parseInt(deliveryPartnerId, 10),
        }),
      });

      if (!res.ok) {
        let message = `Server error: ${res.status} ${res.statusText}`;
        try {
          const err = await res.json();
          if (Array.isArray(err.detail)) message = err.detail.map(d => d.msg).join('; ');
          else if (typeof err.detail === 'string') message = err.detail;
        } catch { }
        throw new Error(message);
      }

      const result = await res.json();
      alert(result.message || 'Assigned successfully!');
      setQrAssigning(false);
      setSelectedBottlesToAssign([]);
      await fetchAllData();
    } catch (e) {
      console.error('Failed to assign bottles:', e);
      alert(e.message || 'Failed to assign bottles.');
    } finally {
      setLoading(false);
    }
  };


  const downloadStickersZip = async () => {
    // FIX: Need to get token inside the handler
    const token =
      accessToken ||
      localStorage.getItem('auth_token') ||
      localStorage.getItem('userToken') ||
      localStorage.getItem('partner_token');

    if (!token) {
      alert('Authentication token not found. Please log in again.');
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE_URL}/bottle/superadmin/download-qr-stickers`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || "Unable to download stickers ZIP.");
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "qr_stickers.zip";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Stickers ZIP Download Error:", err);
      alert("Download failed, check console for details.");
    }
  };

  const handleCreateDeliveryManager = async (e) => {
  e.preventDefault();

  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken") ||
    localStorage.getItem("partner_token");

  if (!token) {
    alert("Authentication token missing.");
    return;
  }

  if (!dmName || !dmEmail || !dmPassword) {
    alert("Name, Email, and Password are required.");
    return;
  }

  if (!selectedStoreIdsDM.length) {
    alert("Please select at least one store.");
    return;
  }

  try {
    setLoading(true);

    // ✅ Create DM
    const createRes = await axios.post(
      `${API_BASE_URL}/partners/partners/superadmin/create-delivery-manager`,
      {
        full_name: dmName,
        email: dmEmail,
        password: dmPassword,
        mobile_number: dmMobile || null,
        area_city: storeFilterCity !== "ALL" ? storeFilterCity : null,
        assigned_stores: selectedStoreIdsDM, // ✅ important
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    alert(`✅ Delivery Manager "${dmName}" created successfully!`);

    // ✅ Reset fields
    setDmName("");
    setDmEmail("");
    setDmPassword("");
    setDmMobilenumber("");
    setSelectedStoreIdsDM([]);

    await fetchAllData();
  } catch (err) {
    console.error("Create DM error:", err?.response?.data || err.message);
    alert(err?.response?.data?.detail || "Failed to create Delivery Manager");
  } finally {
    setLoading(false);
  }
};




  // ✅ Corrected: Add stores to existing manager
  const handleAddStoresToExistingManager = async (managerId, storeIds) => {
  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken");

  if (!token) {
    alert("Authentication token missing. Please login again.");
    return;
  }

  if (!storeIds?.length) {
    alert("Please select at least one store to assign.");
    return;
  }

  try {
    setLoading(true);

    const payload = {
      manager_id: Number(managerId), // ✅ REQUIRED by backend
      store_ids: storeIds.map(String) // ✅ STRING list (as per schema)
    };

    await axios.post(
      `${API_BASE_URL}/partners/partners/superadmin/managers/${managerId}/stores/add`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    alert("✅ Stores assigned successfully!");
    setSelectedStoreIdsToAdd([]);
    await fetchAllData();

  } catch (err) {
    console.error("Add stores error:", err?.response?.data || err);

    const msg =
      err?.response?.data?.detail?.[0]?.msg ||
      "Failed to assign stores";

    alert(msg);
  } finally {
    setLoading(false);
  }
};



  // ✅ Corrected: Remove stores from existing manager
  const handleRemoveStoresFromExistingManager = async (managerId, storeIds) => {
  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken") ||
    localStorage.getItem("partner_token");

  if (!token) {
    alert("Authentication token missing. Please login again.");
    navigate("/login/superadmin");
    return;
  }

  if (!storeIds?.length) {
    alert("Please select at least one store to remove.");
    return;
  }

  try {
    setLoading(true);

    await axios.post(
      `${API_BASE_URL}/partners/partners/superadmin/managers/${managerId}/stores/remove`,
      { store_ids: storeIds }, // ✅ string list
      { headers: { Authorization: `Bearer ${token}` } }
    );

    alert("✅ Stores removed successfully!");
    await fetchAllData();
  } catch (err) {
    console.error("Remove stores error:", err?.response?.data || err.message);
    alert(err?.response?.data?.detail || "Failed to remove stores");
  } finally {
    setLoading(false);
  }
};




  // ------------------------------------------
// --- PARTNER APPROVAL HANDLER ---
const handleApprovePartner = async (partnerId) => {
    try {
      setLoading(true);

      const token =
        accessToken ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('userToken') ||
        localStorage.getItem('partner_token');

      if (!token) {
        alert('Authentication token is missing. Please login again.');
        navigate('/login/superadmin');
        return;
      }

      // Confirm approval
      if (!window.confirm(`Are you sure you want to approve this partner (ID: ${partnerId})?`))
        return;

      // ⭐ FIX: Correct the URL path to use the 'delivery-partners/{id}/approve' structure.
      const response = await axios.patch(
        // The correct path based on the confirmed working structure:
        `${API_BASE_URL}/partners/partners/superadmin/delivery-partners/${partnerId}/approve`,
        // Sending status 'active' is the essential payload for approval on the backend
        { status: 'active' }, 
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      if (response.status === 200 || response.status === 204) {
        alert('✅ Partner approved successfully!');
        setIsPartnerDetailsModalVisible(false);
        setSelectedPartnerForDetails(null);
        await fetchAllData();
      } else {
        console.error('Unexpected response:', response.status, response.data);
        alert(`Unexpected response from server: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Partner approval failed:', error.response?.data || error.message);

      if (error.response?.status === 401) {
        alert('Session expired. Please log in again.');
        navigate('/login/superadmin');
      } else {
        // This is the error seen in the console for 404/Not Found:
        alert(`Failed to approve partner: ${error.response?.data?.detail || error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const PartnerDetailsModal = ({
    isVisible,
    onClose,
    onApprove,
    partner,
    isLoading,
    modalStyles
  }) => {
    if (!isVisible || !partner) return null;

    return (
      <div style={modalStyles.backdrop}>
        <div
          style={{
            ...modalStyles.modal,
            width: '600px',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}
        >
          <h3 style={modalStyles.title}>Partner Approval Details</h3>
          <p style={{ fontWeight: 500, color: '#444' }}>
            Reviewing: <b>{partner.full_name}</b> ({partner.email})
          </p>

          {/* The partner detail grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px' }}>
            <div>
              <p><b>Full Name:</b> {partner.full_name}</p>
              <p><b>Email:</b> {partner.email}</p>
              <p><b>Mobile:</b> {partner.mobile_number}</p>
              <p><b>Address:</b> {partner.current_address}</p>
              <p><b>Vehicle No:</b> {partner.vehicle_number}</p>
              <p><b>License No:</b> {partner.driving_license_number}</p>
              <p><b>ID Type:</b> {partner.id_type}</p>
              <p><b>ID Number:</b> {partner.govt_id}</p>
            </div>
            <div>
              {partner.govt_id_photo_url && (
                <div>
                  <p><b>Government ID Photo:</b></p>
                  <a
                    href={`${API_BASE_URL}/${partner.govt_id_photo_url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src={`${API_BASE_URL}/${partner.govt_id_photo_url}`}
                      alt="Govt ID"
                      style={{ width: '100%', borderRadius: 8 }}
                    />
                  </a>
                </div>
              )}
              {partner.delivery_photo_url && (
                <div style={{ marginTop: 10 }}>
                  <p><b>Partner Photo:</b></p>
                  <a
                    href={`${API_BASE_URL}/${partner.delivery_photo_url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <img
                      src={`${API_BASE_URL}/${partner.delivery_photo_url}`}
                      alt="Partner"
                      style={{ width: '100%', borderRadius: 8 }}
                    />
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Buttons */}
          <div style={modalStyles.actions}>
            <button onClick={onClose} style={modalStyles.cancelButton} disabled={isLoading}>
              Cancel
            </button>
            <button
              onClick={() => onApprove(partner.id)}
              style={modalStyles.submitButton}
              disabled={isLoading}
            >
              {isLoading ? 'Approving...' : 'Approve Partner'}
            </button>
          </div>
        </div>
      </div>
    );
  };


  const StoreDetailsModal = ({ isVisible, onClose, store, partners, modalStyles }) => {
  if (!isVisible || !store) return null;

  // Find assigned partners
  const assignedPartners = partners.filter(p =>
    p.stores.some(s => s.id === store.id)
  );
  const partnerNames = assignedPartners.map(p => p.full_name).join(', ') || 'N/A';

  return (
    <div style={modalStyles.backdrop}>
      <div style={{ ...modalStyles.modal, width: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={modalStyles.title}>Store Details</h3>
        <div style={styles.detailsGrid}>
          <div style={styles.detailsColumn}>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Store Name:</p>
              <p style={styles.detailValue}>{store.store_name}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>City:</p>
              <p style={styles.detailValue}>{store.city}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Address:</p>
              <p style={styles.detailValue}>{store.address || 'N/A'}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Latitude:</p>
              <p style={styles.detailValue}>{store.latitude || 'N/A'}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Longitude:</p>
              <p style={styles.detailValue}>{store.longitude || 'N/A'}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Channel:</p>
              <p style={styles.detailValue}>{store.channel || 'N/A'}</p>
            </div>
            <div style={styles.detailItem}>
              <p style={styles.detailLabel}>Partner(s):</p>
              <p style={styles.detailValue}>{partnerNames}</p>
            </div>
          </div>
        </div>

        <div style={modalStyles.actions}>
          <button onClick={onClose} style={modalStyles.cancelButton}>Close</button>
        </div>
      </div>
    </div>
  );
};



// ------------------------------------------
// --- REPORT UPLOAD / DOWNLOAD HANDLERS ---
const handleUploadReport = async (e) => {
  e.preventDefault();

  const token = accessToken || localStorage.getItem('auth_token') || 
                localStorage.getItem('userToken') || localStorage.getItem('partner_token');

  if (!selectedFile || !reportMonth) {
    alert('Please select a PDF file and choose the month.');
    return;
  }

  setUploadingReport(true);
  const formData = new FormData();
  // Ensure date is formatted as YYYY-MM-DD for backend consistency
  const isoDateString = `${reportMonth}-01`;
  formData.append('report_file', selectedFile);
  formData.append('report_date', isoDateString);

  try {
    const response = await axios.post(`${API_BASE_URL}/reports/reports/upload`, formData, {
      headers: { 
        Authorization: `Bearer ${token}`,
        'Content-Type': 'multipart/form-data' 
      },
    });

    if (response.status >= 200 && response.status < 300) {
      alert('Monthly report uploaded successfully!');
      setSelectedFile(null);
      setReportMonth(new Date().toISOString().slice(0, 7)); // Reset to current month
      
      // Clear the file input manually
      const fileInput = e.target.querySelector('input[type="file"]');
      if (fileInput) fileInput.value = "";

      // Refresh data to show the new report in the list
      await fetchAllData(); 
    }
  } catch (error) {
    console.error('Report upload failed:', error);
    alert(error.response?.data?.detail || 'Upload failed');
  } finally {
    setUploadingReport(false);
  }
};
const handleReportDownload = async (reportId) => {
  const token =
    accessToken ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('userToken') ||
    localStorage.getItem('partner_token');

  if (!token) {
    alert('Authentication required to download file.');
    navigate('/login/superadmin');
    return;
  }

  try {
    const response = await axios.get(`${API_BASE_URL}/reports/reports/download/${reportId}`, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'blob',
    });

    if (response.status === 200) {
      const blob = new Blob([response.data], { type: response.headers['content-type'] });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const filename = `Report_${reportId}_${new Date().toISOString().slice(0, 10)}.pdf`;

      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } else {
      alert(`Download failed: ${response.status}`);
    }
  } catch (error) {
    console.error('Download failed:', error.response?.data || error.message);
    alert('File download failed. Check API endpoint or authorization.');
  }
};

const handleBulkGenerateQR = async () => {
  if (!bulkCount || bulkCount < 1) {
    alert("Enter a valid number of QR codes.");
    return;
  }

  setLoadingBulk(true);

  const token =
    accessToken ||
    localStorage.getItem("auth_token") ||
    localStorage.getItem("userToken") ||
    localStorage.getItem("partner_token");

  try {
    const res = await axios.post(
      `${API_BASE_URL}/bottle/superadmin/generate-qr?count=${bulkCount}`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );

    alert(res.data.message);
    fetchQrData(); // Refresh summary after generation
  } catch (error) {
    console.error(error);
    alert("Bulk QR generation failed");
  } finally {
    setLoadingBulk(false);
  }
};

// --- [FIX 1] ADDED FUNCTION TO HANDLE CHECKBOX CLICKS ---
const handleSelectBottle = (qr_code, isChecked) => {
  setSelectedBottlesToAssign(prev => {
    if (isChecked) {
      // Add to array if not already present
      return [...prev, qr_code];
    } else {
      // Remove from array
      return prev.filter(code => code !== qr_code);
    }
  });
};

// --- [FIX 2] ADDED FUNCTION TO HANDLE SINGLE QR DOWNLOAD ---
const downloadSingleQr = (uuid, qr_code) => {
  try {
    const canvas = document.getElementById(`qr-${uuid}`);
    if (canvas) {
      const pngUrl = canvas
        .toDataURL("image/png")
        .replace("image/png", "image/octet-stream");
      let downloadLink = document.createElement("a");
      downloadLink.href = pngUrl;
      downloadLink.download = `${qr_code}.png`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } else {
      throw new Error("Could not find QR code canvas element.");
    }
  } catch (e) {
    console.error("Failed to download QR:", e);
    alert("Failed to download QR code.");
  }
};


// ------------------------------------------
// --- COMPLAINT RESOLUTION HANDLERS ---
const handleResolveClick = (complaintId) => {
  setCurrentComplaintId(complaintId);
  setSolutionText('');
  setIsSolutionModalVisible(true);
};

const handleCloseModal = () => {
  setIsSolutionModalVisible(false);
  setCurrentComplaintId(null);
  setSolutionText('');
};

const handleSolutionSubmit = async (e) => {
  e.preventDefault();

  const token =
    accessToken ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('userToken') ||
    localStorage.getItem('partner_token');

  const trimmedText = solutionText.trim();

  if (!trimmedText) {
    alert('Please enter a resolution message.');
    return;
  }
  if (!currentComplaintId || !token) {
    alert('Authentication missing or invalid.');
    navigate('/login/superadmin');
    return;
  }

  setResolvingComplaint(true);
  try {
    const payload = { status: 'resolved', solution: trimmedText };
    const response = await axios.patch(
      `${API_BASE_URL}/complaints/complaints/${currentComplaintId}/resolve`,
      payload,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    if (response.status === 200) {
      alert(`Complaint #${currentComplaintId} successfully resolved.`);
      handleCloseModal();
      await fetchAllData();
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

// ------------------------------------------
// --- PARTNER CREATION, EDIT, DELETE HANDLERS ---
const handleCreatePartner = async (e) => {
  e.preventDefault();
  const trimmedFullName = fullName.trim();
  const trimmedEmail = email.trim();
  const trimmedMobile = mobileNumber.trim();
  
  // ⭐ FIX 2: Determine final channel name
  const finalChannel = partnerChannel === "CUSTOM" 
    ? customChannelName.toUpperCase().trim() 
    : partnerChannel.toUpperCase().trim();

  const token =
    accessToken ||
    localStorage.getItem('auth_token') ||
    localStorage.getItem('userToken') ||
    localStorage.getItem('partner_token');

  if (!trimmedFullName || !trimmedEmail || !password || !trimmedMobile) {
    alert('All fields are required.');
    return;
  }
  if (selectedStoreIds.length === 0) {
    alert('Please select at least one store.');
    return;
  }
  if (!token) {
    alert('Authentication token missing.');
    navigate('/login/superadmin');
    return;
  }
  // ⭐ NEW VALIDATION: If custom is selected, check custom field
  if (partnerChannel === "CUSTOM" && !finalChannel) {
      alert('Please enter a name for the custom channel.');
      return;
  }

  setLoading(true);
  const partnerData = {
    full_name: trimmedFullName,
    email: trimmedEmail,
    password,
    mobile_number: trimmedMobile,
    stores: selectedStoreIds,
    role: 'partner',
    // ⭐ FIX 3: Use the dynamically selected/entered channel
    channel: finalChannel, 
  };

  try {
    const response = await axios.post(
      `${API_BASE_URL}/partners/partners/superadmin/create`,
      partnerData,
      {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      }
    );

    if (response.status === 201) {
      alert(`Partner ${trimmedFullName} created successfully for channel ${finalChannel}!`);
      setFullName('');
      setEmail('');
      setPassword('');
      setMobileNumber('');
      setSelectedStoreIds([]);
      setCustomChannelName(''); // Reset custom name field
      await fetchAllData();
      setCurrentTab('myPartners');
    }
  } catch (error) {
    console.error('Partner creation failed:', error.response?.data || error.message);
    alert(`Error: ${error.response?.data?.detail || error.message}`);
  } finally {
    setLoading(false);
  }
};

const handleDeleteChannelAdmin = async (adminId, adminName) => {
    if (!window.confirm(`Are you sure you want to delete channel admin "${adminName}"?`)) {
        return;
    }

    const token =
        accessToken ||
        localStorage.getItem("auth_token") ||
        localStorage.getItem("userToken") ||
        localStorage.getItem("partner_token");

    if (!token) {
        alert("Authentication required.");
        navigate("/login");
        return;
    }

    try {
        await axios.delete(
            `${API_BASE_URL}/partners/partners/superadmin/delete-channel-admin/${adminId}`,
            {
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        alert("Channel Admin deleted successfully!");

        // Refresh list
        fetchChannelAdmins(); // If you made this function
        fetchAllData();       // Or use this if allData includes admins
        
    } catch (error) {
        console.error(error);
        alert(error?.response?.data?.detail || "Failed to delete channel admin");
    }
};



// --- [NEW ADDITION] Handler to delete a partner ---
const handleDeletePartner = async (partnerId, partnerName) => {
    if (!window.confirm(`Are you sure you want to delete the partner "${partnerName}"? This action cannot be undone.`)) {
        return;
    }

    const token =
        accessToken ||
        localStorage.getItem('auth_token') ||
        localStorage.getItem('userToken') ||
        localStorage.getItem('partner_token');

    if (!token) {
        alert('Authentication token missing.');
        navigate('/login/superadmin');
        return;
    }

    setLoading(true);
    try {
        const response = await axios.delete(
            `${API_BASE_URL}/partners/partners/superadmin/delete/${partnerId}`,
            {
                headers: { Authorization: `Bearer ${token}` },
            }
        );

        if (response.status === 200 || response.status === 204) {
            alert('Partner deleted successfully!');
            await fetchAllData(); // Refresh the partner list
        }
    } catch (error) {
        console.error('Partner deletion failed:', error.response?.data || error.message);
        alert(`Error deleting partner: ${error.response?.data?.detail || error.message}`);
    } finally {
        setLoading(false);
    }
};


// ------------------------------------------
// --- LOGOUT HANDLER ---
const handleLogout = () => {
  ['auth_token', 'userToken', 'partner_token', 'user_role', 'store_id', 'store_name'].forEach((k) =>
    localStorage.removeItem(k)
  );
  alert('You have been successfully logged out.');
  navigate('/login');
};

// --- DELETE DELIVERY MANAGER HANDLER (Uses the new API) ---
const handleDeleteManager = async (managerId, managerName) => {
    if (!window.confirm(`Are you sure you want to delete Delivery Manager ${managerName}? This will fail if they still have linked DPs or routed orders.`)) return;

    const token = accessToken || localStorage.getItem('auth_token');
    setLoading(true);
    try {
        await axios.delete(
            `${API_BASE_URL}/partners/partners/superadmin/delete-manager/${managerId}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        alert(`✅ Manager ${managerName} deleted successfully!`);
        await fetchAllData();
    } catch (error) {
        console.error("Delete failed:", error.response?.data || error.message);
        alert(error.response?.data?.detail || "Failed to delete manager. Reassign linked DPs/Orders first.");
    } finally {
        setLoading(false);
    }
};

// --- MOVE DELIVERY PARTNER HANDLER (Uses the new API) ---
// --- MOVE DELIVERY PARTNER HANDLER (FIXED URL) ---
const handleMoveDPSubmit = async (dpId, newManagerId) => {
    const token = accessToken || localStorage.getItem("auth_token");
    setLoading(true);

    try {
        // ⭐ CRITICAL FIX: Removed the redundant "/partners" segment.
        // The path now correctly starts with the router prefix: /partners/superadmin/...
        await axios.patch(
            `${API_BASE_URL}/partners/partners/superadmin/move-dp/${dpId}/to-manager/${newManagerId}`,
            {},
            { headers: { Authorization: `Bearer ${token}` } }
        );

        const action = newManagerId === 0 ? "unassigned" : "reassigned";
        alert(`✅ Delivery Partner successfully ${action}!`);

        setIsReassignModalVisible(false);
        setDpToReassign(null);
        await fetchAllData(); // Refresh data to update lists and team sizes
    } catch (error) {
        console.error("Move failed:", error.response?.data || error.message);
        alert(error.response?.data?.detail || "Failed to move DP.");
    } finally {
        setLoading(false);
    }
};

const handleLinkSubmit = async (dpId, managerId) => {
        const token = accessToken || localStorage.getItem("auth_token");
        setLoading(true);
        try {
            // NOTE: Verified endpoint uses partners/partners/superadmin/delivery-partners/
            await axios.patch(
                `${API_BASE_URL}/partners/partners/superadmin/delivery-partners/${dpId}/assign-manager/${managerId}`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            alert("✅ Delivery Partner linked successfully!");

            // Close modal + reset
            setIsDPLinkingModalVisible(false);
            setManagerToLink(null);
            setSelectedDPId("");

            // This correctly fetches the new assignments for both DMs and DPs:
            await fetchAllData();
        } catch (error) {
            console.error("Linking failed:", error.response?.data || error.message);
            alert(error.response?.data?.detail || "Failed to link partner.");
        } finally {
            setLoading(false);
        }
    };


  const handleSelectTab = (tabName) => {
    setCurrentTab(tabName);

    // 🚀 Auto-fetch data when QR tab opens
    if (tabName === "qrManagement") {
      fetchQrData(); // ✅ Call the main QR fetch function
    }
  };

  // Add this function outside of renderDashboard/renderOrders
const renderManualAssignmentOrders = () => {
  const manualList = manualAssignmentOrders;

  if (manualList.length === 0) {
    return null;
  }

  return (
    <div style={{ ...styles.tableCard, marginBottom: 30 }}>
      <h3
        style={{
          ...styles.cardTitle,
          background: "#E3F2FD",
          borderLeft: "5px solid #1565C0",
          paddingLeft: "15px",
        }}
      >
        🚛 Orders Needing Delivery Manager Assignment ({manualList.length})
      </h3>

      <table style={styles.dataTable}>
        <thead>
          <tr style={{ ...styles.tableHeaderRow, backgroundColor: "#1565C0" }}>
            <th style={styles.tableHeaderCell}>Order ID</th>
            <th style={styles.tableHeaderCell}>Store/City</th>
            <th style={styles.tableHeaderCell}>Bottles</th>
            <th style={styles.tableHeaderCell}>Date</th>
            <th style={styles.tableHeaderCell}>Action</th>
          </tr>
        </thead>

        <tbody>
          {manualList.map((order) => (
            <tr key={order.id} style={styles.tableRow}>
              <td style={styles.tableCell}>#{order.id}</td>
              <td style={styles.tableCell}>
                {order.customerName} ({order.channel})
              </td>
              <td style={styles.tableCell}>{order.bottles}</td>
              <td style={styles.tableCell}>
                {order.orderDate?.toLocaleDateString?.() || "-"}
              </td>

              <td style={styles.tableCell}>
                {/* ✅ UPDATED: Disabled Assign DM Button */}
                <button
                  style={{
                    ...styles.actionButton,
                    backgroundColor: "#9E9E9E",
                    cursor: "not-allowed",
                    opacity: 0.7,
                  }}
                  disabled={true}
                  onClick={() => {}}
                  title="Manual routing disabled for now"
                >
                  Assign Delivery Manager
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ✅ Extra note below table */}
      <p style={{ marginTop: 12, color: "#777", fontSize: "13px" }}>
        ⚠️ Delivery Manager assignment feature will be enabled soon.
      </p>
    </div>
  );
};





  const renderDashboard = () => (
    <div style={styles.contentArea}>
      <div style={styles.kpiRow}>
        <StatCard 
          label="Total Orders" 
          value={totalOrders.toString()} 
          icon="📦" 
          bgColor="#E0F2F1" 
          textColor="#00796B" 
          onPress={() => handleSelectTab('orders')} 
        />
        <StatCard 
          label="Total Revenue" 
          value={`₹${totalRevenue.toLocaleString('en-IN')}`} 
          icon="💰" 
          bgColor="#FCE4EC" 
          textColor="#C2185B" 
          onPress={() => handleSelectTab('orders')} 
        />
        
        {/* ⭐ NEW KPI CARD FOR MANUAL ASSIGNMENT (Routing Failures) ⭐ */}
        <StatCard 
          label="Manual Assignment Required" 
          value={manualAssignmentOrders.length.toString()} 
          icon="⚠️" 
          bgColor="#FFEBEE" 
          textColor="#D32F2F" 
          onPress={() => handleSelectTab('orders')} 
        />
        
        {/* Updated label for clarity: These are pending approval, not routing failures */}
        <StatCard 
          label="Pending Orders (Approval)" 
          value={pendingOrdersCount.toString()} 
          icon="⏰" 
          bgColor="#FFF3E0" 
          textColor="#EF6C00" 
          onPress={() => handleSelectTab('orders')} 
        />
        
        <StatCard 
          label="New Complaints" 
          value={newComplaints.toString()} 
          icon="🚨" 
          bgColor="#FFEBEE" 
          textColor="#D32F2F" 
          onPress={() => handleSelectTab('complaints')} 
        />
        </div>

      <div style={styles.kpiRow}>
        <StatCard 
          label="Fresh Bottles in Warehouse" 
          value={freshBottlesWarehouse.toLocaleString()} 
          icon="💧" 
          bgColor="#E3F2FD" 
          textColor="#1565C0" 
          onPress={() => handleSelectTab('qrManagement')} 
        />
        <StatCard 
          label="Empty Bottles at Stores" 
          value={emptyBottlesStores.toLocaleString()} 
          icon="♻️" 
          bgColor="#FBEFF3" 
          textColor="#AD1457" 
          onPress={() => handleSelectTab('activeStoresList')} 
        />
        <StatCard 
          label="Total Store Managers" 
          value={totalVendors.toString()} 
          icon="🤝" 
          bgColor="#E8F5E9" 
          textColor="#388E3C" 
          onPress={() => handleSelectTab('myPartners')} 
        />
        <StatCard 
          label="Total Delivery Partners" 
          value={totalDeliveryPartners.toString()} 
          icon="🚚" 
          bgColor="#EDE7F6" 
          textColor="#512DA8" 
          onPress={() => handleSelectTab('deliveryPartners')} 
        />
        </div>

      <div style={styles.mainContentGrid}>
        <div style={styles.chartCard}>
          <h3 style={styles.cardTitle}>Sales Performance</h3>
          {/* 🟢 CHART INTEGRATION 🟢 */}
            <MonthlyPerformanceChart data={getMonthlyOrderData} />
        </div>

        <div style={styles.activityCard}>
          <h3 style={styles.cardTitle}>Recent Activity</h3>
          <div style={styles.activityList}>
            {allOrders.slice(0, 5).map((order) => (
              <div key={order.id} style={styles.activityItem}>
                <div style={styles.activityText}>
                  Order <span style={styles.activityOrderId}>#{order.id}</span> by <span style={styles.activityCustomerName}>{order.customerName}</span>
                </div>
                <span style={{
                  ...styles.activityStatusBadge, 
                  backgroundColor: order.status === 'Delivered' ? '#4CAF50' : 
                                   order.status === 'Accepted' ? '#2196F3' : '#FF9800'
                }}>
                  {order.status}
                </span>
              </div>
            ))}
            </div>
        </div>
      </div>

      <div style={styles.kpiRow}>
        <StatCard 
          label="Active Stores" 
          value={totalActiveStores.toString()} 
          icon="🏬" 
          bgColor="#E8F5E9" 
          textColor="#388E3C" 
          onPress={() => handleSelectTab('activeStoresList')} 
        />
        <StatCard 
          label="Monthly Revenue" 
          value={`₹${monthlyRevenue.toLocaleString('en-IN')}`} 
          icon="💸" 
          bgColor="#FBEFF3" 
          textColor="#AD1457" 
          onPress={() => handleSelectTab('orders')} 
        />
        <StatCard 
          label="Total Orders Today" 
          value={dailyOrders.toString()} 
          icon="📅" 
          bgColor="#F0F4C3" 
          textColor="#9E9D24" 
          onPress={() => handleSelectTab('orders')} 
        />
        <StatCard 
          label="Total Orders This Month" 
          value={monthlyOrdersCount.toString()} 
          icon="📈" 
          bgColor="#E1F5FE" 
          textColor="#0277BD" 
          onPress={() => handleSelectTab('orders')} 
        />
        <StatCard 
          label="Delivered Orders Today" 
          value={dailyDeliveredOrders.toString()} 
          icon="✅" 
          bgColor="#D4EDDA" 
          textColor="#155724" 
          onPress={() => handleSelectTab('orders')} 
        />
        <StatCard 
          label="Delivered Orders This Month" 
          value={monthlyDeliveredOrders.toString()} 
          icon="✔️" 
          bgColor="#CBE3F9" 
          textColor="#1E40AF" 
          onPress={() => handleSelectTab('orders')} 
        />
        </div>
    </div>
);


  // In SuperAdminDashboard.jsx (around line 820)

// ... Assuming the renderManualAssignmentOrders function is defined elsewhere in the file ...

const renderOrders = () => {
    if (loading) {
        return <p style={styles.loadingText}>Loading orders...</p>;
    }

    // 1. Group Orders by Channel
    const ordersByChannel = filteredOrders.reduce((acc, order) => {
        const ch = order.channel ? order.channel.toUpperCase() : "GENERAL";
        if (!acc[ch]) acc[ch] = [];
        acc[ch].push(order);
        return acc;
    }, {});

    const channels = Object.keys(ordersByChannel).sort();

    // ⭐ GRID STYLES for Order Cards
    const orderGridStyles = {
        gridContainer: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "18px",
            width: "100%",
            padding: "10px",
        },
        card: {
            background: "#fff",
            border: "1px solid #E0E0E0",
            borderRadius: "10px",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
        },
        title: { fontSize: "16px", fontWeight: "700", marginBottom: "8px" },
        sub: { fontSize: "14px", margin: "3px 0", color: "#444" },
        statusBadge: {
            padding: "5px 12px",
            borderRadius: "20px",
            color: "#fff",
            fontSize: "12px",
            fontWeight: "600",
            display: "inline-block",
            marginTop: "4px",
        },
        actionBtn: {
            marginTop: "12px",
            padding: "8px 12px",
            background: "#4CAF50", // Changed to Green to indicate "Assign"
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "600",
        },
    };

    // ⭐ RENDER single order card
  const renderOrderCard = (o) => (
    <div key={o.id} style={orderGridStyles.card}>
      <div style={orderGridStyles.title}>Order #{o.id}</div>

      <div style={orderGridStyles.sub}>
        <strong>Customer/Store: </strong>{o.customerName}
      </div>

      <div style={orderGridStyles.sub}>
        <strong>Bottles: </strong>{o.bottles}
      </div>

      <div style={orderGridStyles.sub}>
        <strong>Status: </strong>
        <span
          style={{
            ...orderGridStyles.statusBadge,
            backgroundColor: statusColors[o.status] || "#757575",
          }}
        >
          {o.status}
        </span>
      </div>

      {/* ⭐ Manager Assignment Badge ⭐ */}
      <div style={{ marginTop: "6px" }}>
        <span
          style={{
            padding: "4px 10px",
            borderRadius: "14px",
            fontSize: "12px",
            fontWeight: "600",
            background: o.managerName ? "#E8F5E9" : "#FFEBEE",
            color: o.managerName ? "#2E7D32" : "#C62828",
          }}
        >
          {o.managerName ? "Manager Assigned" : "Needs Assignment"}
        </span>
      </div>

      {/* ⭐ DELIVERY MANAGER (REAL DATA) ⭐ */}
      <div style={orderGridStyles.sub}>
        <strong>Manager: </strong>
        {o.managerName ? (
          <span style={{ color: "#2E7D32", fontWeight: "700" }}>
            {o.managerName}
          </span>
        ) : (
          <span style={{ color: "#D32F2F", fontWeight: "700" }}>
            ❌ Unassigned
          </span>
        )}
      </div>

      <div style={orderGridStyles.sub}>
        <strong>Date: </strong>{o.orderDate.toLocaleDateString()}
      </div>

      {/* Assign DP only if order is accepted AND manager exists */}
      {o.status === "Accepted" && o.managerName && (
        <button
          style={orderGridStyles.actionBtn}
          onClick={() => {
            setOrderToAssign(o);
            setSelectedDeliveryPartnerId("");
            setIsOrderAssigningModalVisible(true);
          }}
        >
          Assign Delivery Partner
        </button>
      )}

      {/* Assigned DP Info */}
      {(o.status === "Assigned" || o.status === "Delivered") && (
        <div
          style={{
            ...orderGridStyles.sub,
            marginTop: "8px",
            paddingTop: "8px",
            borderTop: "1px dashed #eee",
          }}
        >
          <strong>Delivery Partner: </strong>
          <span style={{ color: "#1565C0" }}>
            {o.deliveryPartnerName || "Delivery Partner"}
          </span>
        </div>
      )}
    </div>
  );


    // ⭐ CHANNEL SECTION (Collapsible)
    const renderChannelSection = (channelName, orders) => (
        <CollapsibleChannelSection
            key={channelName}
            title={`Channel: ${channelName}`}
            totalCount={orders.length}
            defaultOpen={false}
        >
            <div style={orderGridStyles.gridContainer}>
                {orders.map(o => renderOrderCard(o))}
            </div>
        </CollapsibleChannelSection>
    );

    // ⭐ FINAL UI
    return (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>Orders Overview ({filteredOrders.length})</h2>

            {/* CALL THE MANUAL ASSIGNMENT LIST FIRST */}
            {typeof renderManualAssignmentOrders === 'function' && renderManualAssignmentOrders()}

            {/* EXPORT BUTTON */}
            <button
                style={{ ...styles.button, ...styles.secondaryButton, marginBottom: "20px" }}
                onClick={handleExportOrdersToExcel}
                disabled={loading || filteredOrders.length === 0}
            >
                EXPORT {filteredOrders.length} ORDERS TO CSV
            </button>

            {/* CHANNELS DISPLAY */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                {channels.map(ch =>
                    renderChannelSection(ch, ordersByChannel[ch])
                )}
            </div>
        </div>
    );
};

  const renderCreatePartner = () => {

  // 1️⃣ Stores filtered by selected channel
  const storesForSelectedChannel = allStores.filter(store =>
    store.channel &&
    store.channel.toUpperCase() === partnerChannel.toUpperCase()
  );

  // 2️⃣ Collect already assigned store IDs
  const assignedStoreIds = new Set();
  partners.forEach(partner => {
    if (partner.stores && Array.isArray(partner.stores)) {
      partner.stores.forEach(store => {
        assignedStoreIds.add(store.id);
      });
    }
  });

  // 3️⃣ FINAL FILTER: channel + unassigned + city
  const unassignedStores = storesForSelectedChannel.filter(store => {
    if (assignedStoreIds.has(store.id)) return false;
    if (storeFilterCity && store.city !== storeFilterCity) return false;
    return true;
  });

  return (
    <div style={styles.contentArea}>
      <h2 style={styles.pageTitle}>Create New Partner</h2>

      <div style={styles.formCard}>
        <form style={styles.form} onSubmit={handleCreatePartner}>

          <input
            style={styles.textInput}
            type="text"
            placeholder="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />

          <input
            style={styles.textInput}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            style={styles.textInput}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <input
            style={styles.textInput}
            type="tel"
            placeholder="Mobile Number"
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value)}
            required
          />

          {/* CHANNEL SELECT */}
          <p style={styles.selectStoresTitle}>Select Channel:</p>
          <select
            style={styles.textInput}
            value={partnerChannel}
            onChange={(e) => {
              setPartnerChannel(e.target.value);
              setSelectedStoreIds([]);
              setStoreFilterCity(""); // reset city when channel changes
            }}
          >
            {ALL_CHANNELS.map(channel => (
              <option key={channel} value={channel}>
                {channel.toUpperCase()}
              </option>
            ))}
          </select>

          {/* CUSTOM CHANNEL INPUT */}
          {partnerChannel === "CUSTOM" && (
            <input
              style={styles.textInput}
              type="text"
              placeholder="Enter Custom Channel Name (e.g., RELIANCE FRESH)"
              value={customChannelName}
              onChange={(e) => setCustomChannelName(e.target.value)}
              required
            />
          )}

          {/* ⭐ CITY FILTER */}
          <p style={styles.selectStoresTitle}>Filter Stores by City:</p>
          <select
            style={styles.textInput}
            value={storeFilterCity}
            onChange={(e) => setStoreFilterCity(e.target.value)}
          >
            <option value="">All Cities</option>
            {availableCities.map(city => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>

          {/* STORE LIST */}
          <p style={styles.selectStoresTitle}>
            Select UNASSIGNED Store(s) for{" "}
            {partnerChannel === "CUSTOM"
              ? (customChannelName.toUpperCase() || "New Channel")
              : partnerChannel}
            :
          </p>

          <div style={styles.storeList}>
            {unassignedStores.length > 0 ? (
              unassignedStores.map(store => (
                <label key={store.id} style={styles.checkboxContainer}>
                  <input
                    type="checkbox"
                    checked={selectedStoreIds.includes(store.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedStoreIds(prev => [...prev, store.id]);
                      } else {
                        setSelectedStoreIds(prev =>
                          prev.filter(id => id !== store.id)
                        );
                      }
                    }}
                  />
                  <span style={styles.checkboxLabel}>
                    {store.store_name} ({store.city})
                  </span>
                </label>
              ))
            ) : (
              <p style={styles.noDataText}>
                {storeFilterCity
                  ? `No unassigned stores found in ${storeFilterCity} for ${partnerChannel}.`
                  : `All stores for ${partnerChannel} are already assigned.`}
              </p>
            )}
          </div>

          <button
            style={{ ...styles.button, ...styles.primaryButton }}
            type="submit"
            disabled={loading || selectedStoreIds.length === 0}
          >
            {loading
              ? "Creating..."
              : `Create Store Manager for ${partnerChannel}`}
          </button>

        </form>
      </div>
    </div>
  );
};

  const renderMyPartners = () => {

    // Group partners by channel
    const partnersByChannel = partners.reduce((acc, partner) => {

        const storeChannel = partner.stores && partner.stores.length > 0
            ? partner.stores[0].channel
            : null;

        const channel = (
            partner.channel ||
            storeChannel ||
            "UNASSIGNED"
        ).toUpperCase();

        if (!acc[channel]) acc[channel] = [];
        acc[channel].push(partner);
        return acc;

    }, {});

    const channels = Object.keys(partnersByChannel).sort();


    // ⭐ Render each channel (same style as Active Stores)
    const renderPartnerChannel = (partnerList, channelName) => (
        <CollapsibleChannelSection
            key={channelName}
            title={`Channel: ${channelName}`}
            totalCount={partnerList.length}
            defaultOpen={channelName === channels[0]}
        >
            <div style={styles.tableCard}>
                <table style={styles.dataTable}>
                    <thead>
                        <tr style={styles.tableHeaderRow}>
                            <th style={styles.tableHeaderCell}>Full Name</th>
                            <th style={styles.tableHeaderCell}>Email</th>
                            <th style={styles.tableHeaderCell}>Stores</th>
                            <th style={styles.tableHeaderCell}>Actions</th>
                        </tr>
                    </thead>

                    <tbody>
                        {partnerList.length > 0 ? (
                            partnerList.map((partner) => (
                                <tr key={partner.id} style={styles.tableRow}>
                                    <td style={styles.tableCell}>{partner.full_name}</td>
                                    <td style={styles.tableCell}>{partner.email}</td>

                                    <td style={styles.tableCell}>
                                        {partner.stores.length > 0
                                            ? partner.stores.map(s => s.store_name).join(", ")
                                            : "N/A"}
                                    </td>

                                    <td style={{ ...styles.tableCell, display: "flex", gap: "10px" }}>
                                        <button
                                            onClick={() => handleDeletePartner(partner.id, partner.full_name)}
                                            style={{ ...styles.actionButton, backgroundColor: "#DC3545" }}
                                            disabled={loading}
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr style={styles.tableRow}>
                                <td colSpan="4" style={{ ...styles.tableCell, textAlign: "center" }}>
                                    No partners found in this channel.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </CollapsibleChannelSection>
    );


    // ⭐ Return UI with Horizontal Channel Layout
    return (
        <div style={styles.contentArea}>
        <h2 style={styles.pageTitle}>
          Store POC Management ({partners.length})
        </h2>

            {channels.length > 0 ? (
                <div
                    style={{
                        display: "flex",
                        gap: "20px",
                        flexWrap: "wrap",
                        marginTop: "20px",
                    }}
                >
                    {channels.map((channel) => (
                        <div key={channel} style={{ flex: "0 0 auto" }}>
                            {renderPartnerChannel(partnersByChannel[channel], channel)}
                        </div>
                    ))}
                </div>
            ) : (
                <div style={styles.tableCard}>
                    <p style={styles.noDataText}>No partners found in the database.</p>
                </div>
            )}
        </div>
    );
};


const handleOpenDPLinkModal = (manager) => {
    setManagerToLink(manager);
    setSelectedDPId(''); // Clear selection
    setIsDPLinkingModalVisible(true);
};


const renderDeliveryPartners = () => {
    // Separate DPs by status for clear visibility
    const pendingDPs = allDeliveryPartners.filter(dp => dp.status === 'pending');
    const activeDPs = allDeliveryPartners.filter(dp => dp.status === 'active');
    
    // Helper to open the Reassign Modal
    const handleReassignClick = (dp) => {
        setDpToReassign(dp);
        setIsReassignModalVisible(true);
    };

    return (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>Delivery Partner Approvals & Management ({allDeliveryPartners.length})</h2>

            {/* Section for PENDING DPs */}
            {pendingDPs.length > 0 && (
                <div style={styles.tableCard}>
                    <h3 style={{...styles.cardTitle, borderLeft: '5px solid #FF9800', paddingLeft: '15px'}}>
                        Pending Approval ({pendingDPs.length})
                    </h3>
                    <table style={styles.dataTable}>
                        <thead>
                            <tr style={styles.tableHeaderRow}>
                                <th style={styles.tableHeaderCell}>Full Name</th>
                                <th style={styles.tableHeaderCell}>Email</th>
                                <th style={styles.tableHeaderCell}>Mobile</th>
                                <th style={styles.tableHeaderCell}>Status</th>
                                <th style={styles.tableHeaderCell}>Actions (Review)</th> {/* Updated Header */}
                            </tr>
                        </thead>
                        <tbody>
                            {pendingDPs.map(dp => (
                                <tr key={dp.id} style={styles.tableRow}>
                                    <td style={styles.tableCell}>{dp.full_name}</td>
                                    <td style={styles.tableCell}>{dp.email}</td>
                                    <td style={styles.tableCell}>{dp.mobile_number || 'N/A'}</td>
                                    <td style={styles.tableCell}>
                                        <span style={{...styles.activityStatusBadge, backgroundColor: '#FF9800'}}>
                                            {dp.status}
                                        </span>
                                    </td>
                                    <td style={styles.tableCell}>
                                        <button
                                            onClick={() => {
                                                setSelectedPartnerForDetails(dp);
                                                setIsPartnerDetailsModalVisible(true);
                                            }}
                                            style={styles.actionButton}
                                        >
                                            Review & Approve
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Section for ACTIVE DPs (Manager Actions Added Here) */}
             <div style={styles.tableCard}>
                <h3 style={{...styles.cardTitle, borderLeft: '5px solid #4CAF50', paddingLeft: '15px'}}>
                    Active Partners ({activeDPs.length})
                </h3>
                <table style={styles.dataTable}>
                    <thead>
                        <tr style={styles.tableHeaderRow}>
                            <th style={styles.tableHeaderCell}>Full Name</th>
                            <th style={styles.tableHeaderCell}>Email</th>
                            <th style={styles.tableHeaderCell}>Mobile</th>
                            <th style={styles.tableHeaderCell}>Manager ID</th>
                            <th style={styles.tableHeaderCell}>Status</th>
                            <th style={styles.tableHeaderCell}>Manager Actions</th> {/* <-- IMPORTANT: Action Header */}
                        </tr>
                    </thead>
                    <tbody>
                        {activeDPs.map(dp => (
                            <tr key={dp.id} style={styles.tableRow}>
                                <td style={styles.tableCell}>{dp.full_name}</td>
                                <td style={styles.tableCell}>{dp.email}</td>
                                <td style={styles.tableCell}>{dp.mobile_number || 'N/A'}</td>
                                <td style={styles.tableCell}>{dp.assigned_manager_id || 'None'}</td>
                                <td style={styles.tableCell}>
                                    <span style={{...styles.activityStatusBadge, backgroundColor: '#4CAF50'}}>
                                        {dp.status}
                                    </span>
                                </td>
                                <td style={styles.tableCell}>
                                    {/* ADDED: Reassign Manager Button (Fix for Issue 1) */}
                                    <button
                                        onClick={() => handleReassignClick(dp)}
                                        style={{ ...styles.actionButton, backgroundColor: '#1565C0' }}
                                        disabled={loading}
                                    >
                                        Reassign Manager
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {(pendingDPs.length === 0 && activeDPs.length === 0) && (
                <p style={styles.loadingText}>No delivery partners found in the database.</p>
            )}
        </div>
    );
};
// ==========================
// 🔹 QR MANAGEMENT SECTION
const renderQrManagement = () => (
  <div style={styles.contentArea}>
    <h2 style={styles.pageTitle}>QR Management</h2>

    {/* 🔹 Summary Cards */}
    <div style={styles.kpiRow}>
      <StatCard
        label="Total Fresh Bottles in Warehouse"
        value={freshBottlesWarehouse.toLocaleString()}
        icon="💧"
        bgColor="#E3F2FD"
        textColor="#1565C0"
      />

      <StatCard
        label="Total Unassigned Bottles"
        value={unassignedBottles.length.toLocaleString()}
        icon="📦"
        bgColor="#FFF3E0"
        textColor="#EF6C00"
      />

      <StatCard
        label="Partners Available for Assignment"
        value={approvedDeliveryPartners.length.toLocaleString()}
        icon="🤝"
        bgColor="#E8F5E9"
        textColor="#388E3C"
      />
    </div>

    {/* 🔹 Bulk QR Generator */}
    <div style={styles.formCard}>
      <h3 style={styles.cardTitle}>Bulk QR Generator</h3>

      <div style={{ display: "flex", alignItems: "center", gap: "15px", flexWrap: "wrap" }}>
        <input
          type="number"
          min="1"
          value={bulkCount}
          onChange={(e) => setBulkCount(e.target.value)}
          style={{ ...styles.textInput, width: "120px", fontSize: "18px" }}
        />

        {/* 🔵 Bulk Generate */}
        <button
          onClick={handleBulkGenerateQR}
          disabled={loadingBulk}
          style={{
            ...styles.button,
            backgroundColor: "#1565C0",
            color: "#fff",
            opacity: loadingBulk ? 0.6 : 1,
          }}
        >
          {loadingBulk ? "Generating..." : "Generate QR Codes"}
        </button>

        {/* 🟠 Download ZIP */}
        <button
          onClick={downloadStickersZip}
          style={{
            ...styles.button,
            backgroundColor: "#FF9800",
            color: "#fff",
          }}
        >
          Download Stickers ZIP
        </button>
        
        {/* 🟢 Assign Bottles (MOVED) */}
        <button
          style={{ ...styles.button, backgroundColor: "#2E7D32", color: "#fff" }}
          onClick={() => setQrAssigning(true)}
          disabled={unassignedBottles.length === 0}
        >
          Assign Bottles to Partner
        </button>
      </div>
    </div>

    {/* 🔹 QR Table */}
    <div style={styles.tableCard}>
      <h3 style={styles.cardTitle}>Unassigned Bottles ({unassignedBottles.length})</h3>

      {unassignedBottles.length === 0 ? (
        <p style={{ textAlign: "center", color: "#777", marginTop: "20px" }}>
          No unassigned bottles found.
        </p>
      ) : (
        <table style={styles.dataTable}>
          <thead>
            <tr style={styles.tableHeaderRow}>
              <th style={styles.tableHeaderCell}>UUID</th>
              <th style={styles.tableHeaderCell}>QR Code</th>
              <th style={styles.tableHeaderCell}>Select</th>
            </tr>
          </thead>

          <tbody>
            {unassignedBottles.map((bottle) => (
              <tr key={bottle.UUID} style={styles.tableRow}>

                <td style={styles.tableCell}>{bottle.UUID}</td>

                <td style={styles.tableCell}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <QRCodeCanvas
                      id={`qr-${bottle.UUID}`} // This ID is used by the download function
                      value={bottle.qr_code}
                      size={80}
                      includeMargin={true}
                    />

                    <div style={{ display: "flex", gap: "6px", marginTop: "6px", borderTop: "1px solid #eee", paddingTop: "4px" }}>
                      <button
                        style={styles.qrCopyBtn}
                        onClick={() => {
                          navigator.clipboard.writeText(bottle.qr_code);
                          alert("QR copied: " + bottle.qr_code);
                        }}
                      >
                        📋 Copy
                      </button>

                      {/* --- [FIX 5] This button now works --- */}
                      <button
                        style={styles.qrCopyBtn}
                        onClick={() => downloadSingleQr(bottle.UUID, bottle.qr_code)}
                      >
                        ⬇️ Download
                      </button>
                    </div>

                    <p style={styles.qrCodeLabel}>{bottle.qr_code}</p>
                  </div>
                </td>

                <td style={styles.tableCell}>
                  {/* --- [FIX 6] This checkbox now works --- */}
                  <input
                    type="checkbox"
                    checked={selectedBottlesToAssign.includes(bottle.qr_code)}
                    onChange={(e) => handleSelectBottle(bottle.qr_code, e.target.checked)}
                  />
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </div>
);






 // In SuperAdminDashboard.jsx

const renderComplaints = () => {
  const complaintsByChannel = complaints.reduce((acc, complaint) => {
    const channel = complaint.store?.channel?.toUpperCase() || "GENERAL";
    if (!acc[channel]) acc[channel] = [];
    acc[channel].push(complaint);
    return acc;
  }, {});

  const channels = Object.keys(complaintsByChannel).sort();

  const renderComplaintTable = (complaintList) => (
    <div style={{ ...styles.tableCard, margin: 0, boxShadow: "none" }}>
      <table style={styles.dataTable}>
        <thead>
          <tr style={styles.tableHeaderRow}>
            <th style={styles.tableHeaderCell}>ID</th>
            <th style={styles.tableHeaderCell}>Subject</th>
            <th style={styles.tableHeaderCell}>Description</th>
            <th style={styles.tableHeaderCell}>Raised By (Store/Partner)</th>
            <th style={styles.tableHeaderCell}>Date</th>
            <th style={styles.tableHeaderCell}>Status</th>
            <th style={styles.tableHeaderCell}>Actions</th>
          </tr>
        </thead>

        <tbody>
          {complaintList.map((complaint) => (
            <tr key={complaint.id} style={styles.tableRow}>
              <td style={styles.tableCell}>{complaint.id}</td>
              <td style={styles.tableCell}>{complaint.subject}</td>

              <td style={styles.tableCell}>
                {complaint.description}

                {complaint.photoUrl && (
                  <div style={{ marginTop: "10px" }}>
                    <a
                      href={`${API_BASE_URL}/${complaint.photoUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        ...styles.actionButton,
                        backgroundColor: "#6c757d",
                        textDecoration: "none",
                      }}
                    >
                      📷 View Image
                    </a>
                  </div>
                )}
              </td>

              <td style={styles.tableCell}>
                {complaint.customerName} ({complaint.role?.split(" at ")[0]})
              </td>

              <td style={styles.tableCell}>
                {complaint.date?.toLocaleDateString()}
              </td>

              <td style={styles.tableCell}>
                <span
                  style={{
                    ...styles.activityStatusBadge,
                    backgroundColor:
                      complaint.status?.toLowerCase() === "resolved"
                        ? "#4CAF50"
                        : "#FF9800",
                  }}
                >
                  {complaint.status}
                </span>
              </td>

              <td style={styles.tableCell}>
                {complaint.status?.toLowerCase() === "pending" && (
                  <button
                    style={styles.actionButton}
                    onClick={() => handleResolveClick(complaint.id)}
                  >
                    Resolve
                  </button>
                )}
              </td>
            </tr>
          ))}

          {complaintList.length === 0 && (
            <tr style={styles.tableRow}>
              <td colSpan="7" style={{ ...styles.tableCell, textAlign: "center" }}>
                No complaints found in this channel.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={styles.contentArea}>
      <h2 style={styles.pageTitle}>Complaints Management ({complaints.length})</h2>

      {channels.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", marginTop: "20px" }}>
          {channels.map((channel) => (
            <CollapsibleChannelSection
              key={channel}
              title={`Channel: ${channel}`}
              totalCount={complaintsByChannel[channel].length}
              defaultOpen={channel === "BLINKIT" || channel === "ZEPTO"}
            >
              {renderComplaintTable(complaintsByChannel[channel])}
            </CollapsibleChannelSection>
          ))}
        </div>
      ) : (
        <div style={styles.tableCard}>
          <p style={styles.noDataText}>No complaints found in the database.</p>
        </div>
      )}
    </div>
  );
};


  const renderReports = () => {
  return (
    <div style={styles.contentArea}>
      <h2 style={styles.pageTitle}>Reports Management</h2>

      {/* Tab Switcher */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button
          style={{ 
            ...styles.button, 
            width: 'auto',
            backgroundColor: reportsTab === "monthly" ? '#4CAF50' : '#ccc' 
          }}
          onClick={() => setReportsTab("monthly")}
        >
          Test Reports
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
        <>
          {/* UPLOAD SECTION */}
          <div style={styles.formCard}>
            <h3 style={styles.cardTitle}>Upload Test Report</h3>
            <form
              onSubmit={handleUploadReport}
              style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', color: '#666' }}>Select Month:</label>
                <input
                  type="month"
                  style={{ ...styles.textInput, padding: '8px' }}
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <label style={{ fontSize: '12px', color: '#666' }}>Select PDF File:</label>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  style={styles.fileInput}
                  required
                />
              </div>

              <button
                type="submit"
                style={{ 
                  ...styles.button, 
                  backgroundColor: '#4CAF50', 
                  width: 'auto', 
                  marginTop: '20px',
                  opacity: uploadingReport || !selectedFile ? 0.7 : 1 
                }}
                disabled={uploadingReport || !selectedFile}
              >
                {uploadingReport ? "Uploading..." : "Upload Report"}
              </button>
            </form>
          </div>

          {/* LIST SECTION */}
          <div style={styles.tableCard}>
            <h3 style={{ padding: '20px', margin: 0, borderBottom: '1px solid #eee' }}>
              Available Test Reports ({reports.length})
            </h3>

            <table style={styles.dataTable}>
              <thead>
                <tr style={{ ...styles.tableHeaderRow, backgroundColor: '#1A2A44' }}>
                  <th style={styles.tableHeaderCell}>ID</th>
                  <th style={styles.tableHeaderCell}>Report Name</th>
                  <th style={styles.tableHeaderCell}>For Month</th>
                  <th style={styles.tableHeaderCell}>Action</th>
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 ? (
                  <tr>
                    <td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
                      <div style={{ fontSize: '24px', marginBottom: '10px' }}>📁</div>
                      No reports found in the database.
                    </td>
                  </tr>
                ) : (
                  reports.map((r) => {
                    const displayId = r.id;
                    const displayFileName =
                      r.filename ||
                      (r.report_file
                        ? r.report_file.split('/').pop()
                        : `Test_Report_${r.id}.pdf`);
                    const displayDate = formatReportMonth(
                      r.rawMonthYear || r.report_date
                    );

                    return (
                      <tr key={r.id} style={styles.tableRow}>
                        <td style={styles.tableCell}>#{displayId}</td>
                        <td style={{ ...styles.tableCell, fontWeight: '500' }}>
                          {displayFileName}
                        </td>
                        <td style={styles.tableCell}>{displayDate}</td>
                        <td style={styles.tableCell}>
                          <button
                            style={{ 
                              ...styles.actionButton, 
                              backgroundColor: '#1565C0',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px'
                            }}
                            onClick={() => handleReportDownload(r.id)}
                          >
                            <span>👁️</span> Open PDF
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        /* DELIVERY REPORTS COMPONENT */
        <Reports />
      )}
    </div>
  );
};


  
// 🟢 RENDER QR MANAGEMENT FUNCTION 🟢



// 🟢 RENDER ACTIVE STORES LIST FUNCTION 🟢
const renderActiveStoresList = () => {
  if (loading) {
    return <p style={styles.loadingText}>Loading active stores...</p>;
  }

  // Group stores by channel
  const storesByChannel = allStores.reduce((acc, store) => {
    const channel = store.channel ? store.channel.toUpperCase() : "UNASSIGNED";
    if (!acc[channel]) acc[channel] = [];
    acc[channel].push(store);
    return acc;
  }, {});

  const channels = Object.keys(storesByChannel).sort();

  // Partner → Store mapping
  const partnerStoreMap = partners.reduce((map, partner) => {
    partner.stores.forEach(store => {
      if (!map[store.id]) map[store.id] = [];
      map[store.id].push(partner.full_name);
    });
    return map;
  }, {});

  // Grid styles
  const stylesGrid = {
    gridContainer: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      gap: "16px",
      width: "100%",
      marginTop: "16px",
    },
    storeCard: {
      border: "1px solid #e1e1e1",
      padding: "16px",
      borderRadius: "10px",
      background: "#fff",
      display: "flex",
      flexDirection: "column",
      boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
    },
    storeTitle: {
      fontSize: "16px",
      fontWeight: "600",
      marginBottom: "6px",
    },
    storeSub: {
      margin: "2px 0",
      color: "#444",
      fontSize: "14px",
    },
    storeChannel: {
      fontSize: "13px",
      fontWeight: 600,
      color: "#0052CC",
      marginTop: "4px",
    },
    badge: {
      fontWeight: 600,
      color: "#AD1457",
    },
    actionRow: {
      marginTop: "12px",
      display: "flex",
      gap: "8px",
    },
    actionBtn: {
      padding: "6px 10px",
      borderRadius: "6px",
      border: "none",
      cursor: "pointer",
      fontSize: "13px",
      fontWeight: 500,
    },
    viewBtn: {
      background: "#00B8D9",
      color: "#fff",
    },
    deleteBtn: {
      background: "#E74C3C",
      color: "#fff",
    },
  };

  const renderChannelSection = (stores, channelName) => (
    <CollapsibleChannelSection
      key={channelName}
      title={`Channel: ${channelName}`}
      totalCount={stores.length}
      defaultOpen={channelName === channels[0]}
    >
      <div style={stylesGrid.gridContainer}>
        {stores.map(store => {
          const partnerNames = partnerStoreMap[store.id]
            ? partnerStoreMap[store.id].join(", ")
            : "N/A";

          return (
            <div key={store.id} style={stylesGrid.storeCard}>
              <div style={stylesGrid.storeTitle}>
                {store.store_name}
              </div>

              <div style={stylesGrid.storeSub}>
                <strong>Store ID:</strong> {store.id}
              </div>

              <div style={stylesGrid.storeSub}>
                City: {store.city || "N/A"}
              </div>

              <div style={stylesGrid.storeSub}>
                Address: {store.address || "N/A"}
              </div>

              <div style={stylesGrid.storeSub}>
                Partner(s): {partnerNames}
              </div>

              <div style={stylesGrid.storeChannel}>
                {store.channel || "GENERAL"}
              </div>

              <div style={stylesGrid.actionRow}>
                <button
                  style={{ ...stylesGrid.actionBtn, ...stylesGrid.viewBtn }}
                  onClick={() => {
                    setSelectedStoreForDetails(store);
                    setIsStoreDetailsModalVisible(true);
                  }}
                >
                  View
                </button>

                <button
                  style={{ ...stylesGrid.actionBtn, ...stylesGrid.deleteBtn }}
                  onClick={() => handleDeleteStore(store.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleChannelSection>
  );

  return (
    <div style={styles.contentArea}>
      <h2 style={styles.pageTitle}>
        Store Management ({allStores.length} Total Stores)
      </h2>

      {/* ADD STORE FORM */}
      <div style={styles.formCard}>
        <h3 style={styles.cardTitle}>Add New Store</h3>

        <form onSubmit={handleAddStore} style={styles.form}>

          {/* ⭐ NEW STORE ID FIELD ⭐ */}
          <input
            style={styles.textInput}
            type="text"
            placeholder="Store ID (Outlet ID)"
            value={newStoreId}
            onChange={(e) => setNewStoreId(e.target.value)}
            required
          />

          <input
            style={styles.textInput}
            type="text"
            placeholder="Store Name"
            value={newStoreName}
            onChange={(e) => setNewStoreName(e.target.value)}
            required
          />

          <input
            style={styles.textInput}
            type="text"
            placeholder="City"
            value={newStoreCity}
            onChange={(e) => setNewStoreCity(e.target.value)}
            required
          />

          <input
            style={styles.textInput}
            type="text"
            placeholder="Address"
            value={newStoreAddress}
            onChange={(e) => setNewStoreAddress(e.target.value)}
          />

          <select
            style={styles.textInput}
            value={newStoreChannel}
            onChange={(e) => setNewStoreChannel(e.target.value)}
          >
            {ALL_CHANNELS.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <input
            style={styles.textInput}
            type="number"
            placeholder="Latitude"
            value={newStoreLat}
            onChange={(e) => setNewStoreLat(e.target.value)}
          />

          <input
            style={styles.textInput}
            type="number"
            placeholder="Longitude"
            value={newStoreLong}
            onChange={(e) => setNewStoreLong(e.target.value)}
          />

          <button
            style={{ ...styles.button, ...styles.primaryButton }}
            type="submit"
          >
            Add Store
          </button>
        </form>
      </div>

      {/* CHANNEL SECTIONS */}
      {channels.map(channel =>
        renderChannelSection(storesByChannel[channel], channel)
      )}

      <StoreDetailsModal
        isVisible={isStoreDetailsModalVisible}
        onClose={() => setIsStoreDetailsModalVisible(false)}
        store={selectedStoreForDetails}
        partners={partners}
        modalStyles={styles.modalStyles}
      />
    </div>
  );
};

// ------------------------------------------
// ⭐ NEW: RENDER CHANNEL ADMINS SECTION
// ------------------------------------------
const renderChannelAdmin = () => {
    // Filter out partners and delivery partners, leaving only Channel Admins
    const channelAdmins = channelAdminsList || [];

    const renderAdminTable = () => (
    <div style={styles.tableCard}>
        <table style={styles.dataTable}>
            <thead>
                <tr style={styles.tableHeaderRow}>
                    <th style={styles.tableHeaderCell}>Full Name</th>
                    <th style={styles.tableHeaderCell}>Email</th>
                    <th style={styles.tableHeaderCell}>Channel</th>
                    <th style={styles.tableHeaderCell}>Status</th>
                    <th style={styles.tableHeaderCell}>Actions</th>
                </tr>
            </thead>

            <tbody>
                {channelAdmins.length > 0 ? (
                    channelAdmins.map((admin) => (
                        <tr key={admin.id} style={styles.tableRow}>
                            <td style={styles.tableCell}>{admin.full_name}</td>
                            <td style={styles.tableCell}>{admin.email}</td>
                            <td style={styles.tableCell}>{admin.channel || "N/A"}</td>

                            <td style={styles.tableCell}>
                                <span style={{
                                    ...styles.activityStatusBadge,
                                    backgroundColor: admin.status === "active" ? "#10B981" : "#D97706"
                                }}>
                                    {admin.status || "active"}
                                </span>
                            </td>

                            {/* ⭐ DELETE BUTTON HERE */}
                            <td style={styles.tableCell}>
                                <button
                                    onClick={() =>
                                        handleDeleteChannelAdmin(admin.id, admin.full_name)
                                    }
                                    style={{
                                        padding: "6px 14px",
                                        backgroundColor: "#D32F2F",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: "5px",
                                        cursor: "pointer",
                                        fontSize: "13px",
                                    }}
                                >
                                    Delete
                                </button>
                            </td>
                        </tr>
                    ))
                ) : (
                    <tr style={styles.tableRow}>
                        <td colSpan="5" style={{ ...styles.tableCell, textAlign: "center" }}>
                            No Channel Admins found.
                        </td>
                    </tr>
                )}
            </tbody>
        </table>
    </div>
);

    return (
        <div style={styles.contentArea}>
            <h2 style={styles.pageTitle}>Channel Admin Management ({channelAdmins.length})</h2>

            {/* Existing Admins List */}
            <h3 style={{...styles.cardTitle, borderLeft: '5px solid #1565C0', paddingLeft: '15px'}}>Existing Channel Admins</h3>
            {renderAdminTable()}

            {/* Create Admin Form */}
            <div style={styles.formCard}>
                <h3 style={styles.cardTitle}>Create New Channel Admin</h3>
                <form style={styles.form} onSubmit={handleCreateChannelAdmin}>

                    {/* Full Name */}
                    <input
                      style={styles.textInput}
                      type="text"
                      placeholder="Full Name"
                      value={channelAdminName}
                      onChange={(e) => setChannelAdminName(e.target.value)}
                      required
                    />

                    {/* Email */}
                    <input
                      style={styles.textInput}
                      type="email"
                      placeholder="Email Address"
                      value={channelAdminEmail}
                      onChange={(e) => setChannelAdminEmail(e.target.value)}
                      required
                    />

                    {/* Password */}
                    <input
                      style={styles.textInput}
                      type="password"
                      placeholder="Password"
                      value={channelAdminPassword}
                      onChange={(e) => setChannelAdminPassword(e.target.value)}
                      required
                    />

                    {/* Channel Dropdown */}
            <label style={styles.selectStoresTitle}>Assign Channel</label>

            <select
              style={styles.textInput}
              value={channelAdminChannel}
              onChange={(e) => setChannelAdminChannel(e.target.value)}
            >
              <option value="BLINKIT">Blinkit</option>
              <option value="ZEPTO">Zepto</option>
              <option value="IBM">IBM</option>
              <option value="GENERAL">General</option>
              <option value="CUSTOM">Custom</option>
            </select>

            {/* 🔹 Show only when Custom is selected */}
            {channelAdminChannel === "CUSTOM" && (
              <input
                type="text"
                style={styles.textInput}
                placeholder="Enter Custom Channel Name"
                value={customChannelName}
                onChange={(e) => setCustomChannelName(e.target.value)}
                required
              />
            )}

            {/* Submit Button */}
            <button
              style={{ ...styles.button, backgroundColor: '#1565C0' }}
              type="submit"
            >
              Create Channel Admin
            </button>

                  </form>
            </div>
        </div>
    );
};

  const DPLinkingModal = ({ isVisible, onClose, manager, deliveryPartners, onLinkSubmit, styles, isLoading }) => {
    const [selectedDPId, setSelectedDPId] = useState('');

    if (!isVisible || !manager) return null;

    // --- FIX: Remove Restrictive City Filter ---
    // This filter now includes all active DPs that are currently UNASSIGNED (assigned_manager_id is null or 0).
    const unassignedDPs = deliveryPartners.filter(dp =>
        dp.role === "delivery" 
        && (!dp.assigned_manager_id || dp.assigned_manager_id === 0 || dp.assigned_manager_id === null)
        && (dp.status === 'active')
        // The previous restrictive city filter has been removed.
    );

    // Optional: Sort DPs by city for easier selection by the Super Admin
    unassignedDPs.sort((a, b) => (a.city || "").localeCompare(b.city || ""));

    // --- Handle form submission ---
    const handleLink = (e) => {
        e.preventDefault();
        if (selectedDPId) {
            // Call the handler to link the DP to the current manager
            onLinkSubmit(selectedDPId, manager.id);
        } else {
            alert('Please select a delivery partner to link.');
        }
    };

    return (
        <div style={styles.modalStyles.backdrop}>
            <div style={{ ...styles.modalStyles.modal, maxHeight: '80vh', width: '450px', overflowY: 'auto' }}>
                <h3 style={styles.modalStyles.title}>Link DP to Manager: {manager.full_name}</h3>
                <p style={styles.modalSubtitle}>DM Area: {manager.assigned_area || 'N/A'}</p>

                <form onSubmit={handleLink} style={styles.form}>
                    <label style={styles.reportLabel}>Select Unassigned Delivery Partner:</label>
                    <select
                        style={styles.textInput}
                        value={selectedDPId}
                        onChange={(e) => setSelectedDPId(e.target.value)}
                        required
                        disabled={isLoading || unassignedDPs.length === 0} // Disable if no DPs are available
                    >
                        <option value="">-- Select Partner --</option>
                        {unassignedDPs.map(dp => (
                            <option key={dp.id} value={dp.id}>
                                {dp.full_name} (City: {dp.city || 'N/A'})
                            </option>
                        ))}
                    </select>

                    {unassignedDPs.length === 0 && (
                        <p style={{ color: '#E74C3C', textAlign: 'center', marginTop: '10px' }}>
                            No active, unassigned DPs available to link in any city.
                        </p>
                    )}

                    <div style={styles.modalStyles.actions}>
                        <button type="button" onClick={onClose} style={styles.modalStyles.cancelButton} disabled={isLoading}>
                            Cancel
                        </button>
                        <button type="submit" style={styles.modalStyles.submitButton} disabled={isLoading || !selectedDPId}>
                            {isLoading ? 'Linking...' : 'Link Partner'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const uniqueCities = useMemo(() => {
  return [
    ...new Set(
      allStores
        .map(store => store.city)
        .filter(Boolean)
    )
  ];
}, [allStores]);

const uniqueChannels = useMemo(() => {
  return [
    "ALL",
    ...new Set(
      allStores
        .map(store => store.channel)
        .filter(Boolean)
        .map(ch => ch.toUpperCase())
    )
  ];
}, [allStores]);



const renderDeliveryManagers = () => {
  // --------------------------------------------------
  // STORE ASSIGNMENT LOGIC (FREE STORES ONLY)
  // --------------------------------------------------
 const filteredAvailableStores = allStores.filter(store => {
  // 🔥 ONLY FREE STORES
  if (store.assigned_manager_id !== null) return false;

  if (
    storeFilterCity !== "ALL" &&
    storeFilterCity &&
    store.city?.toLowerCase() !== storeFilterCity.toLowerCase()
  ) return false;

  if (
    storeFilterChannel !== "ALL" &&
    storeFilterChannel &&
    store.channel?.toUpperCase() !== storeFilterChannel.toUpperCase()
  ) return false;

  return true;
});


  // --------------------------------------------------
  // DELIVERY MANAGER TEAM SIZE LOGIC
  // --------------------------------------------------
  const managersWithTeamCount = deliveryManagers.map((dm) => {
    const dmId = Number(dm.id);

    const teamSize = allDeliveryPartners.filter(
      (dp) => Number(dp.assigned_manager_id) === dmId
    ).length;

    return { ...dm, teamSize };
  });

  // --------------------------------------------------
  // UI HANDLERS
  // --------------------------------------------------
  const handleManagerRowClick = (managerId) => {
    // ✅ reset selections when switching managers
    if (expandedManagerId !== managerId) {
      setSelectedStoreIdsToAdd([]);
      setSelectedStoreIdsToRemove([]);
    }
    setExpandedManagerId(expandedManagerId === managerId ? null : managerId);
  };

  const handleReassignClick = (dp) => {
    setDpToReassign(dp);
    setIsReassignModalVisible(true);
  };

  return (
    <div style={styles.contentArea}>
      <h2 style={styles.pageTitle}>
        Delivery Manager Management ({managersWithTeamCount.length})
      </h2>

      {/* --- CREATE NEW DELIVERY MANAGER FORM --- */}
      <div style={styles.formCard}>
        <h3 style={styles.cardTitle}>Create New Delivery Manager</h3>

        <p style={{ color: "#E74C3C", fontWeight: "bold" }}>
          Note: Assignment of stores is mandatory. Orders from these stores will
          be routed to this DM.
        </p>

        <form style={styles.form} onSubmit={handleCreateDeliveryManager}>
          <input
            style={styles.textInput}
            type="text"
            placeholder="Full Name"
            value={dmName}
            onChange={(e) => setDmName(e.target.value)}
            required
          />

          <input
            style={styles.textInput}
            type="email"
            placeholder="Email (Login ID)"
            value={dmEmail}
            onChange={(e) => setDmEmail(e.target.value)}
            required
          />

          <input
            style={styles.textInput}
            type="password"
            placeholder="Password"
            value={dmPassword}
            onChange={(e) => setDmPassword(e.target.value)}
            required
          />

          <input
            style={styles.textInput}
            type="tel"
            placeholder="Mobile Number (Optional)"
            value={dmMobile}
            onChange={(e) => setDmMobilenumber(e.target.value)}
          />

          <p style={styles.selectStoresTitle}>
            Select Stores to Assign to this DM ({filteredAvailableStores.length}{" "}
            shown | {selectedStoreIdsDM.length} selected):
          </p>

          {/* Filter Controls */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
            <select
              style={{ ...styles.textInput, flex: 1, minWidth: "150px" }}
              value={storeFilterCity}
              onChange={(e) => setStoreFilterCity(e.target.value)}
            >
              {uniqueCities.map((city) => (
                <option key={city} value={city}>
                  {city} (City)
                </option>
              ))}
            </select>

            <select
              style={{ ...styles.textInput, flex: 1, minWidth: "150px" }}
              value={storeFilterChannel}
              onChange={(e) => setStoreFilterChannel(e.target.value)}
            >
              {uniqueChannels.map((channel) => (
                <option key={channel} value={channel}>
                  {channel} (Channel)
                </option>
              ))}
            </select>
          </div>

          <div style={styles.storeList}>
            {filteredAvailableStores.length > 0 ? (
              filteredAvailableStores.map((store) => (
                <label key={store.id} style={styles.checkboxContainer}>
                  <input
                    type="checkbox"
                    checked={selectedStoreIdsDM.includes(store.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedStoreIdsDM((prev) => [...prev, store.id]);
                      } else {
                        setSelectedStoreIdsDM((prev) =>
                          prev.filter((id) => id !== store.id)
                        );
                      }
                    }}
                  />
                  <span style={styles.checkboxLabel}>
                    <strong>{store.store_name}</strong> ({store.city} |{" "}
                    {store.channel || "N/A"})
                  </span>
                </label>
              ))
            ) : (
              <p style={styles.noDataText}>
                No unassigned stores match the current filters.
              </p>
            )}
          </div>

          <button
            style={{ ...styles.button, ...styles.primaryButton }}
            type="submit"
            disabled={loading || selectedStoreIdsDM.length === 0}
          >
            {loading ? "Creating..." : "Create Delivery Manager"}
          </button>
        </form>
      </div>

      {/* --- LIST OF DELIVERY MANAGERS --- */}
      <div style={styles.tableCard}>
        <h3 style={styles.cardTitle}>List of Delivery Managers</h3>

        <table style={styles.dataTable}>
          <thead>
            <tr style={styles.tableHeaderRow}>
              <th style={styles.tableHeaderCell}>Full Name</th>
              <th style={styles.tableHeaderCell}>Email</th>
              <th style={styles.tableHeaderCell}>Area/City</th>
              <th style={styles.tableHeaderCell}>Team Size</th>
              <th style={styles.tableHeaderCell}>Stores</th>
              <th style={styles.tableHeaderCell}>Actions</th>
            </tr>
          </thead>

          <tbody>
            {managersWithTeamCount.map((dm) => (
              <React.Fragment key={dm.id}>
                <tr
                  style={{
                    ...styles.tableRow,
                    cursor: "pointer",
                    backgroundColor:
                      expandedManagerId === dm.id ? "#F0F4C3" : "#ffffff",
                    borderLeft:
                      expandedManagerId === dm.id
                        ? "5px solid #9E9D24"
                        : "5px solid transparent",
                  }}
                  onClick={() => handleManagerRowClick(dm.id)}
                >
                  <td style={styles.tableCell}>{dm.full_name}</td>
                  <td style={styles.tableCell}>{dm.email}</td>
                  <td style={styles.tableCell}>
                    {dm.assigned_area || "Unassigned"}
                  </td>

                  <td style={styles.tableCell}>
                    <span
                      style={{
                        fontWeight: "bold",
                        color: dm.teamSize > 0 ? "#4CAF50" : "#E74C3C",
                      }}
                    >
                      {dm.teamSize}
                    </span>
                  </td>

                  <td style={styles.tableCell}>
                    <span
                      style={{
                        fontWeight: "bold",
                        color: dm.store_count > 0 ? "#1976D2" : "#999",
                      }}
                    >
                      {dm.store_count}
                    </span>
                  </td>

                  <td
                    style={{
                      ...styles.tableCell,
                      display: "flex",
                      gap: "8px",
                    }}
                  >
                    <button
                      style={{
                        ...styles.actionButton,
                        backgroundColor: "#FF9800",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDPLinkModal(dm);
                      }}
                      disabled={loading}
                    >
                      Link DP
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (dm.teamSize > 0) {
                          alert(
                            `Error: Cannot delete. ${dm.teamSize} Delivery Partner(s) must be reassigned first.`
                          );
                        } else {
                          handleDeleteManager(dm.id, dm.full_name);
                        }
                      }}
                      style={{
                        ...styles.actionButton,
                        backgroundColor:
                          dm.teamSize > 0 ? "#6c757d" : "#DC3545",
                      }}
                      disabled={loading || dm.teamSize > 0}
                    >
                      Delete DM
                    </button>
                  </td>
                </tr>

                {/* ✅ Expanded Row */}
                {expandedManagerId === dm.id && (
                  <tr style={{ backgroundColor: "#f9f9f9" }}>
                    <td colSpan="6" style={{ padding: "20px" }}>
                      {/* ✅ Assigned Stores + Add/Remove Store UI */}
                      <div style={{ marginBottom: "16px" }}>
                        <h4>Assigned Stores ({dm.store_count})</h4>

                        {dm.stores && dm.stores.length > 0 ? (
                          <ul style={{ paddingLeft: "20px" }}>
                            {dm.stores.map((store) => (
                              <li key={store.id}>
                                <strong>{store.store_name}</strong>{" "}
                                <span style={{ color: "#666" }}>
                                  ({store.city} • {store.channel})
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p style={{ color: "#999" }}>No stores assigned</p>
                        )}

                        {/* ✅ Add Store */}
                        <div
                          style={{
                            marginTop: "14px",
                            padding: "12px",
                            border: "1px solid #eee",
                            borderRadius: "10px",
                          }}
                        >
                          <h4 style={{ marginBottom: "8px" }}>➕ Add Stores</h4>

                          <select
                            multiple
                            value={selectedStoreIdsToAdd}
                            onChange={(e) => {
                              const values = Array.from(e.target.selectedOptions).map(opt =>
                                String(opt.value) // 🔥 FORCE STRING
                              );
                              setSelectedStoreIdsToAdd(values);
                            }}
                            style={{ ...styles.textInput, height: "140px" }}
                          >
                            {filteredAvailableStores.map((store) => (
                              <option key={store.id} value={String(store.id)}>
                                {store.store_name} ({store.city} • {store.channel})
                              </option>
                            ))}
                          </select>


                          <button
                            style={{
                              marginTop: "10px",
                              backgroundColor: "#16a34a",
                              color: "#fff",
                              padding: "10px 14px",
                              border: "none",
                              borderRadius: "8px",
                              cursor: "pointer",
                            }}
                            disabled={loading || selectedStoreIdsToAdd.length === 0}
                            onClick={async () => {
                              await handleAddStoresToExistingManager(
                                dm.id,
                                selectedStoreIdsToAdd // ✅ string[]
                              );
                              await fetchAllData();
                              setSelectedStoreIdsToAdd([]);
                            }}
                          >
                            Assign Selected Stores
                          </button>

                        </div>

                        {/* ✅ Remove Store */}
                        <div
                          style={{
                            marginTop: "14px",
                            padding: "12px",
                            border: "1px solid #eee",
                            borderRadius: "10px",
                          }}
                        >
                          <h4 style={{ marginBottom: "8px" }}>
                            ➖ Remove Stores
                          </h4>

                          <select
                            multiple
                            value={selectedStoreIdsToRemove}
                            onChange={(e) => {
                              const values = Array.from(e.target.selectedOptions).map(opt =>
                                String(opt.value)
                              );
                              setSelectedStoreIdsToRemove(values);
                            }}
                            style={{ ...styles.textInput, height: "140px" }}
                          >
                            {(dm.stores || []).map((s) => (
                              <option key={s.id} value={String(s.id)}>
                                {s.store_name} ({s.city} • {s.channel})
                              </option>
                            ))}
                          </select>


                          <button
                            style={{
                              marginTop: "10px",
                              backgroundColor: "#dc2626",
                              color: "#fff",
                              padding: "10px 14px",
                              border: "none",
                              borderRadius: "8px",
                              cursor: "pointer",
                            }}
                            disabled={
                              loading || selectedStoreIdsToRemove.length === 0
                            }
                            onClick={async () => {
                              await handleRemoveStoresFromExistingManager(dm.id, selectedStoreIdsToRemove);
                              await fetchAllData();
                              setSelectedStoreIdsToRemove([]); // ✅ clear after success
                            }}
                          >
                            Remove Selected Stores
                          </button>
                        </div>
                      </div>

                      {/* Team list */}
                      <ManagerTeamList
                        manager={dm}
                        allDeliveryPartners={allDeliveryPartners}
                        onReassignClick={handleReassignClick}
                        styles={styles}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};



const renderUnassignedOrders = () => (
    <div style={styles.contentArea}>
        {/* Professional Alert Header */}
        <h2 style={{ ...styles.pageTitle, borderLeftColor: '#D32F2F', color: '#B71C1C' }}>
            🚨 Missing Distribution Managers ({orphanedOrders.length})
        </h2>
        <p style={{ marginBottom: '20px', color: '#666', fontSize: '14px' }}>
            The stores below have placed orders but are <strong>not linked to an Area Manager</strong>. 
            Assign a Delivery Manager immediately to route these orders.
        </p>

        {orphanedOrders.length === 0 ? (
            <div style={{ ...styles.tableCard, padding: '40px', textAlign: 'center', color: '#4CAF50' }}>
                <span style={{ fontSize: '40px' }}>✅</span>
                <p style={{ fontWeight: '600', marginTop: '10px' }}>All active orders are correctly covered by Delivery Managers.</p>
            </div>
        ) : (
            <div style={styles.tableCard}>
                <table style={styles.dataTable}>
                    <thead>
                        <tr style={{ ...styles.tableHeaderRow, backgroundColor: '#D32F2F' }}>
                            <th style={styles.tableHeaderCell}>Order ID</th>
                            <th style={styles.tableHeaderCell}>Store (POC)</th>
                            <th style={styles.tableHeaderCell}>Channel</th>
                            <th style={styles.tableHeaderCell}>Status</th>
                            <th style={styles.tableHeaderCell}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orphanedOrders.map((order) => (
                            <tr key={order.id} style={styles.tableRow}>
                                <td style={{ ...styles.tableCell, fontWeight: 'bold' }}>#{order.id}</td>
                                <td style={styles.tableCell}>
                                    <div style={{ fontWeight: '600' }}>{order.customerName}</div>
                                    <div style={{ fontSize: '11px', color: '#888' }}>ID: {order.outlet_code}</div>
                                </td>
                                <td style={styles.tableCell}>
                                    <span style={{ fontSize: '12px', color: '#1565C0', fontWeight: 'bold' }}>
                                        {order.channel}
                                    </span>
                                </td>
                                <td style={styles.tableCell}>
                                    <span style={{ ...styles.activityStatusBadge, backgroundColor: '#FFF3E0', color: '#E65100', border: '1px solid #FFE0B2' }}>
                                        Unrouted
                                    </span>
                                </td>
                                <td style={styles.tableCell}>
                                    <button
                                        onClick={() => handleRouteOrderClick(order)}
                                        style={{
                                            ...styles.actionButton,
                                            backgroundColor: '#D32F2F',
                                            fontWeight: 'bold',
                                            boxShadow: '0 2px 4px rgba(211, 47, 47, 0.3)'
                                        }}
                                    >
                                        Assign DM
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
    </div>
);




  // ==========================
// 🔹 RENDER CONTENT HANDLER
const renderContent = () => {
  switch (currentTab) {
    case "dashboard":
      return renderDashboard();
    case "orders":
      return renderOrders();
    case "createPartner":
  return renderCreatePartner();
    case "myPartners":
      return renderMyPartners();
    case "deliveryPartners":
      return renderDeliveryPartners();
    case "deliveryManagers":          // 🔥 ADD THIS
      return renderDeliveryManagers();
    case "complaints":
      return renderComplaints();
    case "reports":
      return renderReports();
    case "qrManagement":
      return renderQrManagement();

    case "activeStoresList":
      return renderActiveStoresList();

    case "channelAdmin":
      return renderChannelAdmin();
      
    case "unassignedOrders":
    return renderUnassignedOrders();
    default:
      return renderDashboard();
  }
};

// ==========================
// 🔹 MAIN RETURN LAYOUT
return (
  <>
    {/* --- MAIN DASHBOARD LAYOUT --- */}
    <div
      className="dashboard-container"
      style={{ display: "flex", height: "100vh", overflow: "hidden" }}
    >
      {/* --- SIDEBAR --- */}
      <Sidebar
        className="sidebar"
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        orphanedOrdersCount={manualAssignmentOrders.length}
      />

      {/* --- MAIN CONTENT --- */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          overflow: "hidden",
        }}
      >
        {/* --- HEADER --- */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            backgroundColor: "#fff",
            padding: "15px 25px",
            boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
            flexShrink: 0,
            zIndex: 100,
          }}
        >
          <h1 style={{ margin: 0, color: "#102a43", fontSize: "22px" }}>
            Super Admin Dashboard
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ color: "#102a43", fontWeight: 500 }}>Admin User</span>
            <button
              style={{
                backgroundColor: "#ff4d4f",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 16px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
              onClick={handleLogout}
            >
              Logout
            </button>
          </div>
        </header>

        {/* --- MAIN BODY SECTION --- */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            backgroundColor: "#f4f6f8",
            padding: "20px 25px",
          }}
        >
          {loading && currentTab === "dashboard" ? (
            <p style={{ textAlign: "center", color: "#888" }}>
              Loading dashboard data...
            </p>
          ) : (
            renderContent()
          )}
        </div>
      </div>
    </div>

    {/* --- GLOBAL MODALS SECTION --- */}

{/* 🔴 ASSIGN DELIVERY MANAGER MODAL */}
{isAssignDMModalVisible && (
  <div style={styles.modalStyles.backdrop}>
    <div style={{ ...styles.modalStyles.modal, width: "420px" }}>
      <h3 style={styles.modalStyles.title}>
        Assign Delivery Manager
      </h3>

      <p style={styles.modalSubtitle}>
        Order #{orderToAssignDM?.id} – {orderToAssignDM?.customerName}
      </p>

      <select
        style={styles.textInput}
        value={selectedDMId}
        onChange={(e) => setSelectedDMId(e.target.value)}
      >
        {/* 🔑 IMPORTANT: empty value, NOT "ALL" */}
        <option value="">-- Select Delivery Manager --</option>

        {deliveryManagers.map((dm) => (
          <option key={dm.id} value={String(dm.id)}>
            {dm.full_name} ({dm.assigned_area || dm.city || "N/A"})
          </option>
        ))}
      </select>

      <div style={styles.modalStyles.actions}>
        <button
          onClick={() => {
            setIsAssignDMModalVisible(false);
            setSelectedDMId(""); // reset on cancel
          }}
          style={styles.modalStyles.cancelButton}
        >
          Cancel
        </button>

        <button
          onClick={handleAssignDMConfirm}
          style={styles.modalStyles.submitButton}
          disabled={!selectedDMId} // 🔐 safe now
        >
          Assign DM
        </button>
      </div>
    </div>
  </div>
)}


    {/* --- EXISTING MODALS (UNCHANGED) --- */}
    <SolutionModal
      isVisible={isSolutionModalVisible}
      onClose={handleCloseModal}
      onSubmit={handleSolutionSubmit}
      complaintId={currentComplaintId}
      solutionText={solutionText}
      setSolutionText={setSolutionText}
      isLoading={resolvingComplaint}
      modalStyles={styles.modalStyles}
    />

    <AssignBottleModal
      isVisible={qrAssigning}
      onClose={() => setQrAssigning(false)}
      selectedBottlesToAssign={selectedBottlesToAssign}
      approvedDeliveryPartners={approvedDeliveryPartners}
      onAssign={handleAssignBottlesToPartner}
      modalStyles={styles.modalStyles}
    />

    <PartnerDetailsModal
      isVisible={isPartnerDetailsModalVisible}
      onClose={() => setIsPartnerDetailsModalVisible(false)}
      onApprove={handleApprovePartner}
      partner={selectedPartnerForDetails}
      isLoading={loading}
      modalStyles={styles.modalStyles}
    />

    <DPLinkingModal
      isVisible={isDPLinkingModalVisible}
      onClose={() => setIsDPLinkingModalVisible(false)}
      manager={managerToLink}
      deliveryPartners={allDeliveryPartners}
      selectedDPId={selectedDPId}
      setSelectedDPId={setSelectedDPId}
      onLinkSubmit={handleLinkSubmit}
      styles={styles}
      isLoading={loading}
    />

    <ReassignDPModal
      isVisible={isReassignModalVisible}
      onClose={() => setIsReassignModalVisible(false)}
      dp={dpToReassign}
      managers={deliveryManagers}
      onMoveSubmit={handleMoveDPSubmit}
      styles={styles}
      isLoading={loading}
    />
  </>
);
};

const styles = {
  dashboardLayout: {
    display: 'flex',
    minHeight: '100vh',
    height: '100vh', // full screen height
    width: '100vw',
    backgroundColor: '#F0F2F5', 
    fontFamily: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  },
  sidebar: {
    width: '260px',
    backgroundColor: '#2C3E50', 
    color: '#ECF0F1', 
    padding: '25px 0',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '4px 0 10px rgba(0,0,0,0.15)',
  },
  sidebarHeader: {
    padding: '0 25px 30px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    marginBottom: '20px',
  },
  sidebarHeaderTitle: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#4CAF50', 
  },
  sidebarNav: {
    flexGrow: 1,
    padding: '0 15px',
  },
  sidebarItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 15px',
    borderRadius: '8px',
    marginBottom: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background-color 0.2s ease, color 0.2s ease',
    fontSize: '16px',
    color: '#ECF0F1',
  },
  sidebarItemActive: {
    backgroundColor: '#4CAF50', 
    color: '#FFFFFF',
    fontWeight: '600',
  },
  sidebarIcon: {
    fontSize: '20px',
    marginRight: '15px',
  },
  sidebarText: {
    // Inherits color from sidebarItem
  },
  sidebarTextActive: {
    // Inherits color from sidebarItemActive
  },
  mainPanel: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  topHeader: {
    backgroundColor: '#FFFFFF',
    padding: '15px 25px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #E0E0E0',
  },
  headerTitle: {
    fontSize: '24px',
    fontWeight: '600',
    color: '#333',
    margin: 0,
  },
  userProfile: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },
  userName: {
    fontSize: '16px',
    fontWeight: '500',
    color: '#555',
  },
  logoutButton: {
    padding: '8px 16px',
    backgroundColor: '#E74C3C', 
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
  },
  mainContentArea: {
    flexGrow: 1,
    padding: '20px 25px',
    overflowY: 'auto',
    backgroundColor: '#F8FAFC',
  },
  loadingText: {
    textAlign: 'center',
    fontSize: '18px',
    marginTop: '50px',
    color: '#6B7280',
  },
  contentArea: {
    // This wrapper is for the actual content of each tab
  },
  pageTitle: {
    fontSize: '26px',
    fontWeight: '700',
    color: '#333',
    marginBottom: '25px',
    borderLeft: '5px solid #4CAF50',
    paddingLeft: '15px',
  },
  // --- Dashboard specific styles ---
  kpiRow: {
    display: 'grid',
    // Adjust grid template to accommodate 6 cards (2 rows of 3, or 2 rows of 4 + 2 rows of 2, etc.)
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '20px',
    marginBottom: '30px',
  },
  statCard: {
    borderRadius: '12px',
    padding: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
    cursor: 'pointer',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
  },
  statIcon: {
    fontSize: '36px',
    // color inherited from statCard
  },
  statContent: {
    flex: 1,
  },
  statValue: {
    fontSize: '28px',
    fontWeight: 'bold',
    margin: '0',
  },
  statLabel: {
    fontSize: '14px',
    color: 'rgba(0,0,0,0.7)',
    margin: '0',
  },
  mainContentGrid: {
    display: 'grid',
    gridTemplateColumns: '2fr 1fr', 
    gap: '30px',
    marginBottom: '30px',
  },
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    padding: '25px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
  },
  activityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    padding: '25px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
  },
  cardTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '20px',
    borderBottom: '1px solid #EEE',
    paddingBottom: '10px',
  },
  chartPlaceholder: {
    height: '250px',
    backgroundColor: '#F8F9FA',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    color: '#888',
    fontSize: '16px',
    border: '1px dashed #DDD',
    flexDirection: 'column', // Allow content to stack vertically
  },
  activityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  activityItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '10px',
    borderBottom: '1px solid #F5F5F5',
  },
  activityText: {
    fontSize: '15px',
    color: '#555',
  },
  activityOrderId: {
    fontWeight: '600',
    color: '#4CAF50',
  },
  activityCustomerName: {
    fontWeight: '500',
    color: '#2C3E50',
  },
  activityStatusBadge: {
    padding: '5px 10px',
    borderRadius: '15px',
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: '12px',
    // backgroundColor will be set dynamically
  },

  // --- General Table and Form styles ---
  tableCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
    overflow: 'hidden',
    marginBottom: '30px',
    padding: 0, // Ensure table card itself has no padding to keep table full width
  },
  dataTable: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tableHeaderRow: {
    backgroundColor: '#4CAF50', 
    color: '#FFFFFF',
    textAlign: 'left',
  },
  tableHeaderCell: {
    padding: '15px 20px',
    fontWeight: '600',
    fontSize: '14px',
  },
  tableRow: {
    borderBottom: '1px solid #ECEFF1',
    transition: 'background-color 0.2s ease',
  },
  tableCell: {
    padding: '12px 20px',
    color: '#444',
    fontSize: '14px',
  },
  actionButton: {
    padding: '8px 15px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#2196F3', 
    color: '#FFFFFF',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '500',
    textDecoration: 'none',
    transition: 'background-color 0.2s ease',
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '12px',
    padding: '30px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.08)',
    marginBottom: '30px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  // 🌟 NEW STYLES FOR DATE PICKER IN ORDERS TAB 🌟
  datePickerRow: { 
    display: 'flex', 
    gap: '15px', 
    alignItems: 'center', 
    marginBottom: '15px', 
  },
  dateInputContainer: {
    position: 'relative',
    flex: 1,
  },
  dateInput: {
    width: '100%',
    padding: '12px 15px',
    borderRadius: '8px',
    border: '1px solid #DCE0E6',
    fontSize: '16px',
    color: '#333',
    outline: 'none',
    boxSizing: 'border-box',
    background: '#fff',
  },
  clearButton: { 
    background: '#F5F5F5', 
    border: '1px solid #E74C3C', 
    color: '#E74C3C', 
    fontWeight: '600', 
    borderRadius: '8px', 
    padding: '10px 15px', 
    cursor: 'pointer', 
    fontSize: '14px', 
    height: '44px', 
    flexShrink: 0,
  },

  // --- New Report Specific Styles ---
  reportsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 30px 10px',
    borderBottom: '1px solid #E0E0E0',
    marginBottom: '10px',
  },
  reportUploadForm: {
    display: 'flex',
    gap: '20px',
    alignItems: 'flex-end',
    padding: '0 0 10px 0',
  },
  reportFormGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flex: 1,
  },
  reportLabel: {
    fontWeight: '500',
    color: '#555',
    fontSize: '14px',
  },
  fileInput: {
    border: '1px solid #DCE0E6',
    borderRadius: '8px',
    padding: '10px',
    backgroundColor: '#F8F9FA',
  },
  secondaryButton: {
    backgroundColor: '#1565C0', // Blue for export
    color: '#FFFFFF',
    padding: '10px 20px',
    borderRadius: '6px',
    border: 'none',
    fontWeight: '600',
    cursor: 'pointer',
    fontSize: '16px',
    transition: 'background-color 0.2s ease',
  },
  // --- Existing form styles adjusted for reports
  textInput: {
    padding: '12px 15px',
    borderRadius: '8px',
    border: '1px solid #DCE0E6',
    fontSize: '16px',
    color: '#333',
    outline: 'none',
    transition: 'border-color 0.2s ease',
  },
  button: {
    padding: '14px 25px',
    borderRadius: '8px',
    border: 'none',
    color: '#FFFFFF',
    fontWeight: '600',
    cursor: 'pointer',
    fontSize: '16px',
    transition: 'background-color 0.2s ease',
  },
  primaryButton: {
    backgroundColor: '#4CAF50', // Green primary button
  },
  // --- Partner Creation Store Dropdown Styles (FIXED FOR REACT) ---
    selectStoresTitle: { fontSize: '16px', fontWeight: '600', color: '#333', marginBottom: '10px', display: 'block' },
    storeList: {
        maxHeight: '300px',
        overflowY: 'auto',
        border: '1px solid #DCE0E6',
        borderRadius: '8px',
        padding: '10px',
        backgroundColor: '#F8F9FA',
    },
    checkboxContainer: {
        display: 'flex',
        alignItems: 'center',
        padding: '8px 5px',
        cursor: 'pointer',
        borderBottom: '1px dashed #EEE',
    },
    checkboxLabel: {
        marginLeft: '10px',
        fontSize: '14px',
        color: '#333',
    },
  // --- QR Management Styles (PORTED AND CLEANED) ---
    generatedQrContainer: {
        marginTop: '25px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '20px',
        backgroundColor: '#F9FAFB',
        borderRadius: '10px',
        border: '1px solid #E0E0E0',
    },
    qrCodeWrapper: {
        backgroundColor: '#FFFFFF',
        padding: '10px',
        borderRadius: '8px',
        marginBottom: '15px',
        border: '1px solid #DDD',
    },
    qrPlaceholder: {
        width: '150px',
        height: '150px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#ECEFF1',
        color: '#888',
        fontSize: '12px',
        margin: 0,
    },
    generatedQrText: {
        fontSize: '18px',
        fontWeight: '600',
        color: '#333',
        marginBottom: '10px',
    },
    qrCodeLabel: {
        fontSize: '16px',
        color: '#4CAF50',
        fontWeight: 'bold',
        marginBottom: '15px',
        wordBreak: 'break-all',
        textAlign: 'center',
    },
    copyButton: {
        padding: '10px 15px',
        backgroundColor: '#6B7280',
        color: '#FFFFFF',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: '600',
    },
    bottleList: {
        maxHeight: '300px', 
        overflowY: 'auto',
        border: '1px solid #E0E0E0',
        borderRadius: '8px',
        padding: '10px',
        backgroundColor: '#FFFFFF',
        marginBottom: '10px',
    },
  // --- QR Table Button Styles ---
  qrCopyBtn: {
    background: 'none',
    border: '1px solid #007bff',
    color: '#007bff',
    padding: '3px 6px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '10px',
    fontWeight: '600',
  },
  qrCodeLabel: {
    fontSize: '12px',
    color: '#555',
    marginTop: '5px',
    fontFamily: 'monospace',
  },

  // --- Modal Styles ---
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
        width: '400px',
        maxWidth: '90%',
        boxShadow: '0 8px 20px rgba(0, 0, 0, 0.2)',
    },
    title: {
        fontSize: '20px',
        fontWeight: '600',
        color: '#333',
        marginBottom: '20px',
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
        fontSize: '16px',
        color: '#6B7280',
        marginBottom: '20px',
        textAlign: 'left',
        borderBottom: '1px solid #EEE',
        paddingBottom: '15px'
  },
  detailsGrid: {
    display: 'flex',
    flexDirection: 'row',
    gap: '20px',
  },
  detailsColumn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  detailItem: {
    display: 'flex',
    flexDirection: 'column',
  },
  detailLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#555',
    margin: '0 0 4px 0',
  },
  detailValue: {
    fontSize: '15px',
    color: '#333',
    margin: '0',
    wordBreak: 'break-word',
  },
  imageItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  detailImage: {
    width: '100%',
    maxWidth: '250px',
    height: 'auto',
    borderRadius: '8px',
    border: '1px solid #DDD',
    backgroundColor: '#F8F8F8',
  },
  
  button: {
  marginTop: "20px",
  width: "100%",
  padding: "12px",
  backgroundColor: "#28a745",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
  fontSize: "16px",
  cursor: "pointer",
  fontWeight: "600",
  textAlign: "center",
},

sidebar: {
    width: '260px',
    backgroundColor: '#1a2a44',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column'
  },
  sidebarItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 20px',
    backgroundColor: 'transparent',
    color: '#a0aec0',
    border: 'none',
    width: '100%',
    cursor: 'pointer',
    textAlign: 'left'
  },
  sidebarItemActive: {
    backgroundColor: '#2d3748',
    color: '#fff',
    borderLeft: '4px solid #4CAF50'
  },
  sidebarIcon: { marginRight: '12px' },
  // Table card for the unassigned orders
  tableCard: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    overflow: 'hidden'
  },
  pageTitle: {
        fontSize: '24px',
        fontWeight: '700',
        color: '#102A43',
        marginBottom: '20px',
        borderLeft: '6px solid #4CAF50',
        paddingLeft: '15px',
        display: 'flex',
        alignItems: 'center',
    },

    // Refined table card to match your active tabs
    tableCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: '12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
        overflow: 'hidden',
        border: '1px solid #E0E4E8',
        marginBottom: '30px',
    },

    // Status badge for a clean pill look
    activityStatusBadge: {
        padding: '4px 12px',
        borderRadius: '20px',
        fontSize: '11px',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
    },

    // Grid details for better spacing
    detailsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '20px',
        marginTop: '15px'
    }

  

  
};

  
export default SuperAdminDashboard;