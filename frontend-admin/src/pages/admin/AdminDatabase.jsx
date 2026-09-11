import React, { useState, useEffect, useCallback } from 'react';
import { 
  Database, 
  Table, 
  Search, 
  RefreshCcw, 
  Plus, 
  Edit2, 
  Trash2, 
  ChevronRight, 
  ChevronLeft, 
  X, 
  Save, 
  Play, 
  Code,
  FileJson,
  AlertCircle,
  CheckCircle2,
  Filter
} from 'lucide-react';
import toast from 'react-hot-toast';
import { API_BASE_URL } from '../../config';
import { useStore } from '../../store/useStore';
import { apiFetch } from '../../utils/apiFetch'

const AdminDatabase = () => {
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [schema, setSchema] = useState([]);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, total_pages: 1 });
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [currentRow, setCurrentRow] = useState(null);
  const [sqlQuery, setSqlQuery] = useState('');
  const [queryResult, setQueryResult] = useState(null);
  const [activeTab, setActiveTab] = useState('browser'); // 'browser' or 'query'

  const fetchTables = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/admin/db/tables');
      const result = await response.json();
      if (result.success) {
        setTables(result.data);
        if (result.data.length > 0 && !selectedTable) {
          setSelectedTable(result.data[0]);
        }
      } else {
        toast.error(result.message || 'Failed to fetch tables');
      }
    } catch {
      toast.error('Network error while fetching tables');
    } finally {
      setLoading(false);
    }
  }, [selectedTable]);

  const fetchTableData = useCallback(async (tableName, page = 1) => {
    setLoading(true);
    try {
      const response = await apiFetch(`/admin/db/table/${tableName}?page=${page}&per_page=20`);
      const result = await response.json();
      if (result.success) {
        setSchema(result.data.schema);
        setData(result.data.data);
        setPagination(result.data.pagination);
      } else {
        toast.error(result.message || 'Failed to fetch table data');
      }
    } catch {
      toast.error('Network error while fetching table data');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auth is cookie-based; referencing the nonexistent `adminToken` here crashed the whole page
  }, []);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  useEffect(() => {
    if (selectedTable && activeTab === 'browser') {
      fetchTableData(selectedTable, pagination.page);
    }
  }, [selectedTable, pagination.page, fetchTableData, activeTab]);

  const handleUpdate = async (e) => {
    e.preventDefault();
    try {
      const response = await apiFetch(`/admin/db/table/${selectedTable}/${currentRow.id}`, {
        method: 'PUT',
        body: JSON.stringify(currentRow)
      });
      const result = await response.json();
      if (result.success) {
        toast.success('Row updated successfully');
        setIsEditModalOpen(false);
        fetchTableData(selectedTable, pagination.page);
      } else {
        toast.error(result.message || 'Update failed');
      }
    } catch {
      toast.error('Network error during update');
    }
  };

  const handleDelete = async (rowId) => {
    if (!window.confirm('Are you sure you want to delete this row? This action cannot be undone.')) return;
    
    try {
      const response = await apiFetch(`/admin/db/table/${selectedTable}/${rowId}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (result.success) {
        toast.success('Row deleted successfully');
        fetchTableData(selectedTable, pagination.page);
      } else {
        toast.error(result.message || 'Delete failed');
      }
    } catch {
      toast.error('Network error during deletion');
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      const response = await apiFetch(`/admin/db/table/${selectedTable}`, {
        method: 'POST',
        body: JSON.stringify(currentRow)
      });
      const result = await response.json();
      if (result.success) {
        toast.success('Row added successfully');
        setIsAddModalOpen(false);
        fetchTableData(selectedTable, 1);
      } else {
        toast.error(result.message || 'Insertion failed');
      }
    } catch {
      toast.error('Network error during insertion');
    }
  };

  const executeSql = async () => {
    if (!sqlQuery.trim()) return;
    setLoading(true);
    try {
      const response = await apiFetch('/admin/db/query', {
        method: 'POST',
        body: JSON.stringify({ query: sqlQuery })
      });
      const result = await response.json();
      if (result.success) {
        setQueryResult(result.data);
        toast.success('Query executed successfully');
      } else {
        setQueryResult({ error: result.message });
        toast.error(result.message || 'Query failed');
      }
    } catch {
      toast.error('Network error during query execution');
    } finally {
      setLoading(false);
    }
  };

  const filteredData = data.filter(row => 
    Object.values(row).some(val => 
      String(val).toLowerCase().includes(searchTerm.toLowerCase())
    )
  );

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Database className="w-8 h-8 text-amber-500" />
            Database Explorer
          </h1>
          <p className="text-slate-500 text-sm">Professional database management and control center.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-slate-100 p-1 rounded-xl flex gap-1">
            <button 
              onClick={() => setActiveTab('browser')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'browser' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Table className="w-4 h-4 inline-block mr-2" />
              Table Browser
            </button>
            <button 
              onClick={() => setActiveTab('query')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'query' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Code className="w-4 h-4 inline-block mr-2" />
              SQL Console
            </button>
          </div>
          <button 
            onClick={() => fetchTables()}
            className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-600 transition-all"
            title="Refresh Schema"
          >
            <RefreshCcw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        {/* Sidebar: Table List */}
        <div className="w-64 flex flex-col gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex-1 flex flex-col min-h-0 shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Tables ({tables.length})</h3>
            <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
              {tables.map(table => (
                <button
                  key={table}
                  onClick={() => {
                    setSelectedTable(table);
                    setActiveTab('browser');
                    setPagination({ ...pagination, page: 1 });
                  }}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-between group ${selectedTable === table ? 'bg-amber-50 text-amber-700 border border-amber-100 shadow-sm' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 border border-transparent'}`}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <Table className={`w-4 h-4 flex-shrink-0 ${selectedTable === table ? 'text-amber-500' : 'text-slate-400'}`} />
                    <span className="truncate">{table}</span>
                  </div>
                  <ChevronRight className={`w-4 h-4 opacity-0 group-hover:opacity-100 transition-all ${selectedTable === table ? 'opacity-100' : ''}`} />
                </button>
              ))}
            </div>
          </div>
          
          <div className="bg-slate-900 rounded-2xl p-4 text-white shadow-xl">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-2 h-2 rounded-full ${loading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></div>
              <span className="text-xs font-bold text-slate-400 uppercase">System Status</span>
            </div>
            <p className="text-sm font-medium">Live Database</p>
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Tables loaded</span>
                <span className="text-emerald-400">{tables.length}</span>
              </div>
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Connection</span>
                <span className={tables.length > 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {tables.length > 0 ? 'Healthy' : (loading ? 'Checking…' : 'Unreachable')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-h-0 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          {activeTab === 'browser' ? (
            <>
              {/* Toolbar */}
              <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
                <div className="flex items-center gap-3 flex-1 max-w-xl">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder={`Search in ${selectedTable}...`}
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all shadow-sm"
                    />
                  </div>
                  <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
                    <button className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-slate-600 transition-all">
                      <Filter className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      const emptyRow = {};
                      schema.forEach(col => {
                        if (col.name !== 'id') emptyRow[col.name] = '';
                      });
                      setCurrentRow(emptyRow);
                      setIsAddModalOpen(true);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
                  >
                    <Plus className="w-4 h-4" />
                    New Record
                  </button>
                </div>
              </div>

              {/* Data Table */}
              <div className="flex-1 overflow-auto custom-scrollbar relative">
                {loading && (
                  <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] z-10 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCcw className="w-8 h-8 text-amber-500 animate-spin" />
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Syncing Data...</span>
                    </div>
                  </div>
                )}
                
                <table className="w-full text-left border-collapse min-w-max">
                  <thead className="sticky top-0 bg-slate-50 z-[5]">
                    <tr>
                      <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100">Actions</th>
                      {schema.map(col => (
                        <th key={col.name} className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100">
                          <div className="flex flex-col gap-0.5">
                            <span>{col.name}</span>
                            <span className="text-[8px] opacity-60 font-medium">{col.type}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredData.length > 0 ? (
                      filteredData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                              <button 
                                onClick={() => {
                                  setCurrentRow({...row});
                                  setIsEditModalOpen(true);
                                }}
                                className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={() => handleDelete(row.id)}
                                className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                          {schema.map(col => (
                            <td key={col.name} className="px-4 py-3 text-sm text-slate-600 max-w-[300px] truncate">
                              {row[col.name] === null ? (
                                <span className="text-slate-300 italic text-xs">NULL</span>
                              ) : typeof row[col.name] === 'boolean' ? (
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${row[col.name] ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {row[col.name] ? 'TRUE' : 'FALSE'}
                                </span>
                              ) : String(row[col.name])}
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={schema.length + 1} className="px-4 py-20 text-center text-slate-400">
                          <div className="flex flex-col items-center gap-4">
                            <Search className="w-12 h-12 opacity-20" />
                            <p className="font-medium">No records found matching your criteria.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="p-4 border-t border-slate-100 bg-slate-50/30 flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase">
                  Showing {filteredData.length} of {pagination.total || 0} entries
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    disabled={pagination.page <= 1}
                    onClick={() => setPagination({...pagination, page: pagination.page - 1})}
                    className="p-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-black shadow-sm">
                    PAGE {pagination.page} / {pagination.total_pages}
                  </div>
                  <button 
                    disabled={pagination.page >= pagination.total_pages}
                    onClick={() => setPagination({...pagination, page: pagination.page + 1})}
                    className="p-2 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* SQL Console Tab */
            <div className="flex flex-col h-full bg-slate-900">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
                    <Code className="w-5 h-5 text-amber-500" />
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-sm">SQL Console</h3>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Execute Raw SQL Statements</p>
                  </div>
                </div>
                <button 
                  onClick={executeSql}
                  disabled={loading || !sqlQuery.trim()}
                  className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-black hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-900/20"
                >
                  <Play className="w-4 h-4" />
                  RUN QUERY
                </button>
              </div>
              
              <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
                <div className="flex-1 bg-slate-950 border border-slate-800 rounded-2xl p-4 shadow-inner relative overflow-hidden group">
                  <textarea
                    value={sqlQuery}
                    onChange={(e) => setSqlQuery(e.target.value)}
                    placeholder="SELECT * FROM users WHERE role = 'super_admin' LIMIT 10;"
                    className="w-full h-full bg-transparent text-amber-200 font-mono text-sm focus:outline-none resize-none placeholder:text-slate-700"
                  />
                  <div className="absolute top-4 right-4 text-[10px] font-black text-slate-700 pointer-events-none group-focus-within:text-amber-500/50 transition-all uppercase">
                    SQL/SQLite Syntax
                  </div>
                </div>

                <div className="flex-1 bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden flex flex-col shadow-inner">
                  <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                    <span className="text-[10px] font-black text-slate-500 uppercase">Results Output</span>
                    {queryResult && Array.isArray(queryResult) && (
                      <span className="text-[10px] font-black text-emerald-500 uppercase">{queryResult.length} rows returned</span>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto custom-scrollbar-dark p-4">
                    {!queryResult ? (
                      <div className="h-full flex flex-col items-center justify-center text-slate-700 gap-3">
                        <Play className="w-12 h-12 opacity-10" />
                        <p className="text-sm font-medium">Run a query to see results here.</p>
                      </div>
                    ) : queryResult.error ? (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                        <div>
                          <p className="text-red-400 font-bold text-sm uppercase">Query Execution Error</p>
                          <p className="text-red-500 text-xs mt-1 font-mono">{queryResult.error}</p>
                        </div>
                      </div>
                    ) : Array.isArray(queryResult) && queryResult.length > 0 ? (
                      <table className="w-full text-left border-collapse font-mono text-xs">
                        <thead>
                          <tr>
                            {Object.keys(queryResult[0]).map(k => (
                              <th key={k} className="px-3 py-2 text-slate-500 border-b border-slate-800">{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {queryResult.map((row, i) => (
                            <tr key={i}>
                              {Object.values(row).map((v, j) => (
                                <td key={j} className="px-3 py-2 text-slate-400 whitespace-nowrap max-w-[200px] truncate">{String(v)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        <p className="text-emerald-400 text-sm font-bold uppercase">Success: Command executed successfully.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit/Add Modal */}
      {(isEditModalOpen || isAddModalOpen) && (
        <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h3 className="text-xl font-bold text-slate-900">
                  {isEditModalOpen ? `Edit Record in ${selectedTable}` : `New Record in ${selectedTable}`}
                </h3>
                <p className="text-sm text-slate-500 uppercase font-bold tracking-wider mt-0.5">Advanced Row Editor</p>
              </div>
              <button 
                onClick={() => {
                  setIsEditModalOpen(false);
                  setIsAddModalOpen(false);
                }}
                className="p-2 hover:bg-white rounded-xl text-slate-400 hover:text-slate-600 transition-all shadow-sm"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form 
              onSubmit={isEditModalOpen ? handleUpdate : handleAdd}
              className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar"
            >
              <div className="grid grid-cols-2 gap-6">
                {schema.filter(col => col.name !== 'id').map(col => (
                  <div key={col.name} className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">
                      {col.name} <span className="text-slate-300">({col.type})</span>
                    </label>
                    {col.type.toUpperCase().includes('TEXT') || col.type.toUpperCase().includes('CHAR') || col.name.includes('image') || col.name.includes('url') ? (
                      <textarea
                        value={currentRow?.[col.name] || ''}
                        onChange={(e) => setCurrentRow({...currentRow, [col.name]: e.target.value})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all min-h-[80px]"
                      />
                    ) : (
                      <input
                        type={col.type.toUpperCase().includes('INT') || col.type.toUpperCase().includes('REAL') ? 'number' : 'text'}
                        step="any"
                        value={currentRow?.[col.name] || ''}
                        onChange={(e) => setCurrentRow({...currentRow, [col.name]: e.target.value})}
                        className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all"
                      />
                    )}
                  </div>
                ))}
              </div>
            </form>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button 
                type="button"
                onClick={() => {
                  setIsEditModalOpen(false);
                  setIsAddModalOpen(false);
                }}
                className="px-6 py-2.5 text-slate-600 font-bold text-sm hover:bg-slate-100 rounded-xl transition-all"
              >
                Discard Changes
              </button>
              <button 
                onClick={isEditModalOpen ? handleUpdate : handleAdd}
                className="flex items-center gap-2 px-8 py-2.5 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
              >
                <Save className="w-4 h-4" />
                {isEditModalOpen ? 'Update Record' : 'Create Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }

        .custom-scrollbar-dark::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar-dark::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar-dark::-webkit-scrollbar-thumb {
          background: #1e293b;
          border-radius: 10px;
        }
        .custom-scrollbar-dark::-webkit-scrollbar-thumb:hover {
          background: #334155;
        }
      `}} />
    </div>
  );
};

export default AdminDatabase;
