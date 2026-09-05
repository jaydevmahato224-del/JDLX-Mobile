import React, { useState, useEffect } from 'react';
import { Activity, Server, Database, HardDrive, Shield, AlertTriangle, RefreshCw, Wrench, CheckCircle, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../../config';
import { apiFetch } from '../../utils/apiFetch';

const AdminSystemHealth = () => {
    const [healthData, setHealthData] = useState(null);
    const [systemLogs, setSystemLogs] = useState(null);
    const [selfHealing, setSelfHealing] = useState({ active: false, logs: [] });
    const [scanning, setScanning] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const navigate = useNavigate();

    const fetchHealthData = async () => {
        try {
            setLoading(true);
            setError(null);

            const [healthRes, logsRes, healingRes] = await Promise.all([
                apiFetch('/admin/system/health').then(res => {
                    if (!res.ok) throw new Error('Failed to fetch system health data');
                    return res.json();
                }),
                apiFetch('/admin/system/logs').then(res => res.json()),
                apiFetch('/admin/system/self-healing').then(res => res.json())
            ]);

            setHealthData(healthRes);
            setSystemLogs(logsRes);
            setSelfHealing({ active: healingRes.self_healing_mode, logs: healingRes.logs || [] });
        } catch (err) {
            setError(err.message || 'Failed to fetch system health data');
        } finally {
            setLoading(false);
        }
    };

    const triggerScan = async () => {
        try {
            setScanning(true);
            setSelfHealing(prev => ({ ...prev, active: true })); // Immediate UI feedback
            const res = await apiFetch('/admin/system/self-healing/scan', {
                method: 'POST',
            });
            await fetchHealthData();
            if (res.ok) alert("System repair completed successfully. Self-Healing Mode has been turned OFF.");
        } catch (e) {
            console.error(e);
            alert("Scan failed");
        } finally {
            setScanning(false);
        }
    };

    useEffect(() => {
        fetchHealthData();
        // Auto-refresh every 10 seconds
        const interval = setInterval(fetchHealthData, 10000);
        return () => clearInterval(interval);
    }, []);

    if (loading && !healthData) {
        return (
            <div className="flex h-full items-center justify-center p-8">
                <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    if (error && !healthData) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
                <div className="flex items-center gap-3">
                    <AlertTriangle className="h-6 w-6" />
                    <h2 className="text-lg font-semibold">System Unreachable</h2>
                </div>
                <p className="mt-2">{error}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                    <button
                        onClick={fetchHealthData}
                        className="rounded-xl bg-red-600 px-6 py-2.5 text-white font-bold hover:bg-red-700 transition-all active:scale-95 shadow-lg shadow-red-200 flex items-center gap-2"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Retry Connection
                    </button>
                    <button
                        onClick={() => navigate('/admin/server-control')}
                        className="rounded-xl bg-white border-2 border-red-200 px-6 py-2.5 text-red-600 font-bold hover:bg-red-50 transition-all active:scale-95 flex items-center gap-2"
                    >
                        <ExternalLink className="w-4 h-4" />
                        Open Server Control
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-gray-900">System Health Monitor</h1>
                <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-500">
                        Last updated: {new Date(healthData.timestamp * 1000).toLocaleTimeString()}
                    </span>
                    <button
                        onClick={fetchHealthData}
                        title="Refresh Metrics"
                        className={`rounded-full p-2 text-gray-500 hover:bg-gray-100 ${loading ? 'animate-spin text-blue-600' : ''}`}
                    >
                        <RefreshCw className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* Self Healing Toggle */}
            <div className={`rounded-xl border p-6 flex flex-col md:flex-row items-center justify-between shadow-sm transition-all ${selfHealing.active ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-200'}`}>
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-full ${selfHealing.active ? 'bg-blue-200 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                        <Wrench className={`w-6 h-6 ${scanning ? 'animate-spin' : ''}`} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">Enable Auto Bug Detection & Repair</h2>
                        <p className="text-sm text-gray-500">Run a deep-level heuristic sweep to correct deadlocks, broken routes, and API misconfigurations.</p>
                        {selfHealing.active && <p className="text-sm font-bold text-blue-600 mt-1">Self-Healing Mode Activated. System is scanning for issues...</p>}
                    </div>
                </div>
                <div className="mt-4 md:mt-0 flex items-center gap-3 border border-gray-200 bg-gray-50 rounded-full p-1 shadow-inner cursor-pointer" onClick={() => !scanning && triggerScan()}>
                    <button disabled={scanning} className={`px-6 py-2 rounded-full font-bold text-sm transition-all ${!selfHealing.active && !scanning ? 'bg-white shadow text-gray-800' : 'text-gray-500'}`}>OFF</button>
                    <button disabled={scanning} className={`px-6 py-2 rounded-full font-bold text-sm transition-all ${selfHealing.active || scanning ? 'bg-blue-600 shadow text-white' : 'text-gray-500 hover:text-gray-800'}`}>ON</button>
                </div>
            </div>

            {/* Auto Healing Logs */}
            {selfHealing.logs && selfHealing.logs.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                    <div className="bg-gray-50 px-4 py-3 border-b flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-600" />
                        <h3 className="font-semibold text-gray-900">System Recovery Logs</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-white">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Issue Detected</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Module</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fix Applied</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Result</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {selfHealing.logs.map((log) => (
                                    <tr key={log.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(log.timestamp).toLocaleString()}</td>
                                        <td className="px-6 py-4 text-sm font-bold text-red-600">{log.issue_detected}</td>
                                        <td className="px-6 py-4 text-sm font-semibold text-gray-800">{log.module}</td>
                                        <td className="px-6 py-4 text-sm text-gray-600">{log.fix_applied}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-600">{log.result}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                {/* Overall Status */}
                <div className={`overflow-hidden rounded-xl border ${healthData.status === 'healthy' ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'} p-6 shadow-sm`}>
                    <div className="flex items-center gap-4">
                        <div className={`rounded-lg p-3 ${healthData.status === 'healthy' ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'}`}>
                            <Activity className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">System Status</p>
                            <h3 className={`text-2xl font-bold ${healthData.status === 'healthy' ? 'text-green-700' : 'text-amber-700'}`}>
                                {healthData.status.toUpperCase()}
                            </h3>
                        </div>
                    </div>
                </div>

                {/* Database Status */}
                <div className={`overflow-hidden rounded-xl border ${healthData.database.status === 'healthy' ? 'border-gray-200 bg-white' : 'border-red-200 bg-red-50'} p-6 shadow-sm`}>
                    <div className="flex items-center gap-4">
                        <div className={`rounded-lg p-3 ${healthData.database.status === 'healthy' ? 'bg-blue-50 text-blue-600' : 'bg-red-100 text-red-600'}`}>
                            <Database className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Database</p>
                            <h3 className="text-xl font-bold text-gray-900">
                                {healthData.database.status === 'healthy' ? 'Connected' : 'Disconnected'}
                            </h3>
                            <p className="text-sm text-gray-500">Latency: {healthData.database.latency_ms}ms</p>
                        </div>
                    </div>
                </div>

                {/* CPU Usage */}
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="rounded-lg bg-indigo-50 p-3 text-indigo-600">
                            <Server className="h-6 w-6" />
                        </div>
                        <div className="w-full">
                            <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">CPU Usage ({healthData.cpu.cores} Cores)</p>
                            <div className="mt-2 flex items-center justify-between">
                                <span className="text-xl font-bold text-gray-900">{healthData.cpu.usage_percent}%</span>
                            </div>
                            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                                <div
                                    className={`h-full rounded-full ${healthData.cpu.usage_percent > 85 ? 'bg-red-500' : healthData.cpu.usage_percent > 60 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                                    style={{ width: `${healthData.cpu.usage_percent}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Memory Usage */}
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="rounded-lg bg-violet-50 p-3 text-violet-600">
                            <HardDrive className="h-6 w-6" />
                        </div>
                        <div className="w-full">
                            <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Memory</p>
                            <div className="mt-2 flex items-center justify-between">
                                <span className="text-xl font-bold text-gray-900">{healthData.memory.usage_percent}%</span>
                                <span className="text-xs text-gray-500">{healthData.memory.used_mb}MB / {healthData.memory.total_mb}MB</span>
                            </div>
                            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                                <div
                                    className={`h-full rounded-full ${healthData.memory.usage_percent > 85 ? 'bg-red-500' : healthData.memory.usage_percent > 60 ? 'bg-amber-500' : 'bg-violet-500'}`}
                                    style={{ width: `${healthData.memory.usage_percent}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2">
                {/* Disk Space */}
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                    <h3 className="mb-4 text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <HardDrive className="h-5 w-5 text-gray-500" />
                        Storage Overview (Partition)
                    </h3>
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-600">Used Space</span>
                                <span className="font-medium">{healthData.disk.used_gb} GB</span>
                            </div>
                            <div className="flex justify-between text-sm mb-1">
                                <span className="text-gray-600">Total Space</span>
                                <span className="font-medium">{healthData.disk.total_gb} GB</span>
                            </div>
                            <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-gray-100">
                                <div
                                    className={`h-full rounded-full ${healthData.disk.usage_percent > 90 ? 'bg-red-500' : 'bg-blue-500'}`}
                                    style={{ width: `${healthData.disk.usage_percent}%` }}
                                />
                            </div>
                            <p className="mt-1 text-right text-xs text-gray-500">{healthData.disk.usage_percent}% Used</p>
                        </div>
                    </div>
                </div>

                {/* Auth & Security Status */}
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                    <h3 className="mb-4 text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <Shield className="h-5 w-5 text-gray-500" />
                        Security & Auth Services
                    </h3>
                    <ul className="space-y-4">
                        <li className="flex items-center justify-between p-3 border border-gray-100 rounded-lg bg-gray-50">
                            <div className="flex items-center gap-3">
                                <div className="h-2 w-2 rounded-full bg-green-500" />
                                <span className="font-medium text-gray-700">OAuth / Login Service</span>
                            </div>
                            <span className="text-sm font-semibold text-green-600 uppercase">Operational</span>
                        </li>
                        <li className="flex items-center justify-between p-3 border border-gray-100 rounded-lg bg-gray-50">
                            <div className="flex items-center gap-3">
                                <div className="h-2 w-2 rounded-full bg-green-500" />
                                <span className="font-medium text-gray-700">Role-Based Access Control</span>
                            </div>
                            <span className="text-sm font-semibold text-green-600 uppercase">Enforced</span>
                        </li>
                        <li className="flex items-center justify-between p-3 border border-gray-100 rounded-lg bg-gray-50">
                            <div className="flex items-center gap-3">
                                <div className="h-2 w-2 rounded-full bg-green-500" />
                                <span className="font-medium text-gray-700">Rate Limiter Shield</span>
                            </div>
                            <span className="text-sm font-semibold text-green-600 uppercase">Active</span>
                        </li>
                    </ul>
                </div>
            </div>

            {/* AI Security Guard & Activity Logs */}
            {systemLogs && (
                <div className="mt-8 space-y-6">
                    <h2 className="text-xl font-bold text-gray-900 border-b pb-2">AI Security Guard Logs</h2>

                    {/* Blocked IPs */}
                    <div className="rounded-xl border border-red-200 bg-white overflow-hidden shadow-sm">
                        <div className="bg-red-50 px-4 py-3 border-b border-red-200 flex justify-between items-center">
                            <h3 className="font-semibold text-red-900 flex items-center gap-2">
                                <Shield className="h-5 w-5 text-red-600" />
                                Actively Blocked IPs ({systemLogs.blocked_ips?.length || 0})
                            </h3>
                        </div>
                        <div className="p-0 overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">IP Address</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Blocked Until</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time Remaining</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {systemLogs.blocked_ips?.length > 0 ? (
                                        systemLogs.blocked_ips.map((block, idx) => (
                                            <tr key={idx} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{block.ip_address}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(block.blocked_until).toLocaleString()}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">{Math.ceil(block.retry_after_seconds / 60)} minutes</td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr><td colSpan="3" className="px-6 py-4 text-center text-sm text-gray-500">No IPs currently blocked</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                        {/* Security Alerts */}
                        <div className="rounded-xl border border-amber-200 bg-white overflow-hidden shadow-sm">
                            <div className="bg-amber-50 px-4 py-3 border-b border-amber-200">
                                <h3 className="font-semibold text-amber-900">Recent Security Anomalies</h3>
                            </div>
                            <div className="p-0">
                                <ul className="divide-y divide-gray-200">
                                    {systemLogs.suspicious_activity?.length > 0 ? (
                                        systemLogs.suspicious_activity.map((alert, idx) => (
                                            <li key={idx} className="p-4 hover:bg-gray-50">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${alert.severity === 'critical' ? 'bg-red-100 text-red-800' : alert.severity === 'high' ? 'bg-orange-100 text-orange-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                                        {alert.alert_type}
                                                    </span>
                                                    <span className="text-xs text-gray-500">{new Date(alert.created_at).toLocaleString()}</span>
                                                </div>
                                                <p className="text-sm text-gray-700 mt-2">{alert.message}</p>
                                                {alert.ip_address && <p className="text-xs text-gray-400 mt-1">IP: {alert.ip_address}</p>}
                                            </li>
                                        ))
                                    ) : (
                                        <li className="p-4 text-center text-sm text-gray-500">No anomalies detected</li>
                                    )}
                                </ul>
                            </div>
                        </div>

                        {/* Failed Logins */}
                        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                                <h3 className="font-semibold text-gray-900">Failed Login Register</h3>
                            </div>
                            <div className="p-0">
                                <ul className="divide-y divide-gray-200">
                                    {systemLogs.failed_login_attempts?.length > 0 ? (
                                        systemLogs.failed_login_attempts.map((login, idx) => (
                                            <li key={idx} className="p-4 flex items-center justify-between hover:bg-gray-50">
                                                <div>
                                                    <p className="text-sm font-medium text-gray-900">{login.email}</p>
                                                    <p className="text-xs text-gray-500">IP: {login.ip_address}</p>
                                                </div>
                                                <span className="text-xs text-gray-500">{new Date(login.timestamp).toLocaleString()}</span>
                                            </li>
                                        ))
                                    ) : (
                                        <li className="p-4 text-center text-sm text-gray-500">No failed logins recorded</li>
                                    )}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminSystemHealth;
