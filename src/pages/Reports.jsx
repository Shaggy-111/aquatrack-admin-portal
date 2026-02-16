import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../config";

/* ---------------- STATIC DATA ---------------- */
const CHANNELS = ["BLINKIT", "ZEPTO", "IBM", "GENERAL", "CUSTOM"];

/* ---------------- KPI CARD ---------------- */
const KpiCard = ({ label, value, bg, color, icon }) => (
  <div
    style={{
      padding: 18,
      borderRadius: 10,
      background: bg,
      color,
      minWidth: 190,
      position: "relative",
      boxShadow: "0 4px 10px rgba(0,0,0,0.06)",
      flex: "1 1 200px",
    }}
  >
    <div style={{ fontSize: 13, opacity: 0.8 }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: "bold", marginTop: 6 }}>
      {value}
    </div>
    <div style={{ position: "absolute", top: 12, right: 16, fontSize: 22 }}>
      {icon}
    </div>
  </div>
);

const Reports = () => {
  const token =
    localStorage.getItem("auth_token") ||
    localStorage.getItem("partner_token") ||
    localStorage.getItem("userToken");

  // ✅ role check
  const userRole =
    localStorage.getItem("user_role") ||
    localStorage.getItem("userRole") ||
    localStorage.getItem("role") ||
    "";

  const userChannel =
    localStorage.getItem("channel_name") ||
    localStorage.getItem("channel") ||
    localStorage.getItem("channelName") ||
    "";

  const isSuperadmin = userRole?.toLowerCase() === "superadmin";
  const isChannelAdmin = userRole?.toLowerCase() === "channel_admin";

  const [subTab, setSubTab] = useState("orders");
  const [rows, setRows] = useState([]);
  const [storeRows, setStoreRows] = useState({ rows: [] });
  const [dailyRows, setDailyRows] = useState([]);
  const [exceptionRows, setExceptionRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // ✅ Removed total_cost
  const [summary, setSummary] = useState({
    total_deliveries: 0,
    total_cans: 0,
  });

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [channel, setChannel] = useState("");
  const [storeId, setStoreId] = useState("");

  // ✅ Channel Admin / Partner / Manager -> auto set channel
  useEffect(() => {
    if (!isSuperadmin && userChannel) {
      setChannel(userChannel.toUpperCase());
    }
  }, [isSuperadmin, userChannel]);

  const formatDateTime = (dateStr) => {
    if (!dateStr || dateStr === "-" || dateStr === "null") return "-";
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return "-";

      return date.toLocaleString("en-IN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
    } catch {
      return "-";
    }
  };

  const filteredRows = rows.filter((r) => {
    const rowChannel = r.channel ? r.channel.toUpperCase() : "";
    const selectedChannel = channel ? channel.toUpperCase() : "";

    if (selectedChannel && rowChannel !== selectedChannel) return false;
    if (state && r.state !== state) return false;
    if (city && r.city !== city) return false;
    return true;
  });

  // ✅ STATES FROM FILTERED DATA
  const dbStates = [...new Set(filteredRows.map((r) => r.state).filter(Boolean))];

  // ✅ CITIES FROM FILTERED STATE
  const dbCities = state
    ? [
        ...new Set(
          filteredRows
            .filter((r) => r.state === state)
            .map((r) => r.city)
            .filter(Boolean)
        ),
      ]
    : [];

  const fetchOrderReports = async () => {
    try {
      setLoading(true);

      const params = {
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        state: state || undefined,
        city: city || undefined,
        channel: channel || undefined,
        store_id: storeId || undefined,
      };

      const res = await axios.get(`${API_BASE_URL}/delivery-reports/orders`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      setRows(res.data?.rows || []);

      // ✅ Removed total_cost from default
      setSummary(
        res.data?.summary || {
          total_deliveries: 0,
          total_cans: 0,
        }
      );
    } catch (err) {
      console.error("Order fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchStoreSummary = async () => {
    try {
      setLoading(true);
      const params = {
        state: state || undefined,
        city: city || undefined,
        channel: channel || undefined, // ✅ IMPORTANT (channel admin view)
      };

      const res = await axios.get(`${API_BASE_URL}/delivery-reports/store-summary`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      setStoreRows(res.data || { rows: [] });
    } catch (err) {
      setStoreRows({ rows: [] });
    } finally {
      setLoading(false);
    }
  };

  const fetchDailySummary = async () => {
    try {
      setLoading(true);

      const params = {
        channel: channel || undefined, // ✅ IMPORTANT
      };

      const res = await axios.get(`${API_BASE_URL}/delivery-reports/daily-summary`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      setDailyRows(res.data?.rows || []);
    } catch (err) {
      console.error("Daily fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchExceptions = async () => {
    try {
      setLoading(true);

      const params = {
        channel: channel || undefined, // ✅ IMPORTANT
      };

      const res = await axios.get(`${API_BASE_URL}/delivery-reports/exceptions`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      setExceptionRows(res.data?.rows || []);
    } catch (err) {
      console.error("Exception fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  /* -------- DOWNLOAD EXCEL (PIVOT FORMAT) -------- */
  const downloadPivotExcel = async () => {
    if (!fromDate || !toDate) {
      return alert("Please select both start and end dates from the calendar.");
    }

    try {
      const params = {
        from_date: fromDate,
        to_date: toDate,
        state: state || undefined,
        city: city || undefined,
        channel: channel || undefined,
      };

      const res = await axios.get(`${API_BASE_URL}/reports/reports/monthly-pivot/export`, {
        params,
        responseType: "blob",
        headers: { Authorization: `Bearer ${token}` },
      });

      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `Distribution_${fromDate}_to_${toDate}.xlsx`;
      link.click();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export Error:", err);
      alert(
        "Monthly Pivot Export failed. Ensure your orders are in 'assigned_to_manager' or 'delivered' status."
      );
    }
  };

  const clearFilters = () => {
    setFromDate("");
    setToDate("");
    setState("");
    setCity("");
    setStoreId("");

    // ✅ Channel must stay fixed for channel_admin
    if (isSuperadmin) {
      setChannel("");
    } else {
      setChannel(userChannel.toUpperCase());
    }

    refreshData(subTab);
  };

  const refreshData = (tab) => {
    if (tab === "stores") fetchStoreSummary();
    else if (tab === "daily") fetchDailySummary();
    else if (tab === "exceptions") fetchExceptions();
    else fetchOrderReports();
  };

  useEffect(() => {
    refreshData(subTab);
  }, [subTab, state, city, channel]); // ✅ Added channel also

  const totalDeliveries = filteredRows.length;

  const incompleteOrdersCount = filteredRows.filter(
    (r) => !["delivered", "delivered_confirmed"].includes(r.status)
  ).length;

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ marginBottom: 20 }}>Reports</h2>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        {["orders", "stores", "daily", "exceptions"].map((t) => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              background: subTab === t ? "#4CAF50" : "#eee",
              color: subTab === t ? "#fff" : "#333",
              border: "none",
              cursor: "pointer",
              fontWeight: "500",
            }}
          >
            {t === "orders"
              ? "Order Details"
              : t === "stores"
              ? "Store Summary"
              : t === "daily"
              ? "Daily Summary"
              : "Exceptions"}
          </button>
        ))}
      </div>

      {(subTab === "orders" || subTab === "stores") && (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 20,
            alignItems: "center",
          }}
        >
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={{ padding: "6px" }}
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={{ padding: "6px" }}
          />

          {/* STATE – from DB only */}
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setCity("");
            }}
            style={{ padding: "6px" }}
          >
            <option value="">All States</option>
            {dbStates.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* CITY – from DB only */}
          <select
            value={city}
            disabled={!state}
            onChange={(e) => setCity(e.target.value)}
            style={{ padding: "6px" }}
          >
            <option value="">All Cities</option>
            {dbCities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* ✅ Channel Dropdown (Disabled for Channel Admin) */}
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            disabled={!isSuperadmin} // ✅ only superadmin can change
            style={{ padding: "6px" }}
          >
            {isSuperadmin ? (
              <>
                <option value="">All Entities (Channels)</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </>
            ) : (
              <option value={userChannel.toUpperCase()}>
                {userChannel.toUpperCase()}
              </option>
            )}
          </select>

          <button
            onClick={() => refreshData(subTab)}
            style={{
              padding: "7px 20px",
              backgroundColor: "#4CAF50",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Apply
          </button>

          <button
            onClick={clearFilters}
            style={{
              padding: "7px 15px",
              backgroundColor: "#f44336",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Clear
          </button>

          {subTab === "orders" && (
            <button
              onClick={downloadPivotExcel}
              style={{
                padding: "7px 15px",
                backgroundColor: "#217346",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              📊 Download Monthly Distribution
            </button>
          )}
        </div>
      )}

      {subTab === "orders" && (
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 25,
          }}
        >
          <KpiCard
            label="Total Deliveries"
            value={totalDeliveries}
            bg="#E8F5E9"
            color="#1B5E20"
            icon="📦"
          />
          <KpiCard
            label="Total Cans"
            value={summary.total_cans}
            bg="#E3F2FD"
            color="#0D47A1"
            icon="🧴"
          />
          {/* ✅ Total Cost removed */}
          <KpiCard
            label="Incomplete Orders"
            value={incompleteOrdersCount}
            bg="#FFEBEE"
            color="#B71C1C"
            icon="⚠️"
          />
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <div
          style={{
            backgroundColor: "white",
            borderRadius: "8px",
            overflow: "hidden",
            boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
          }}
        >
          {subTab === "orders" ? (
            <table
              width="100%"
              style={{ borderCollapse: "collapse", fontSize: "13px" }}
            >
              <thead style={{ backgroundColor: "#f8f9fa" }}>
                <tr>
                  <th style={{ padding: "12px" }}>Entity</th>
                  <th style={{ padding: "12px" }}>State</th>
                  <th style={{ padding: "12px" }}>City</th>
                  <th style={{ padding: "12px" }}>Outlet Code</th>
                  <th style={{ padding: "12px" }}>Outlet Name</th>
                  <th style={{ padding: "12px" }}>Delivered</th>
                  <th style={{ padding: "12px" }}>Status</th>
                  <th style={{ padding: "12px" }}>Delivered At</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan="8" align="center" style={{ padding: "20px" }}>
                      No records found
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ padding: "12px" }}>{r.channel || "N/A"}</td>
                      <td style={{ padding: "12px" }}>{r.state}</td>
                      <td style={{ padding: "12px" }}>{r.city}</td>
                      <td style={{ padding: "12px" }}>{r.outlet_code}</td>
                      <td style={{ padding: "12px" }}>{r.outlet_name}</td>
                      <td style={{ padding: "12px" }}>
                        {r.bottles_delivered || r.delivered || 0}
                      </td>
                      <td style={{ padding: "12px" }}>{r.status}</td>
                      <td style={{ padding: "12px" }}>
                        {formatDateTime(r.delivered_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : null}

          {/* ✅ Store Summary / Daily Summary / Exceptions you can render later same way */}
        </div>
      )}
    </div>
  );
};

export default Reports;
