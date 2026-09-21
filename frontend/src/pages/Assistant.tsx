import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Sparkles, 
  ChevronRight, 
  Terminal, 
  Database, 
  AlertTriangle, 
  CornerDownRight, 
  ArrowRight,
  ArrowUp,
  Shield,
  Users,
  Award,
  FileText,
  ShieldAlert,
  Search,
  Scale,
  RefreshCw,
  Edit2,
  Copy,
  Check,
  ExternalLink,
  History,
  Clock,
  Trash2,
  ChevronDown
} from 'lucide-react';
import { api, prepareInvestigationTabBridge } from '../services/api';
import { PaginatedTable, AssignedRolesList } from '../components/InvestigationComponents';
import { TableExportControl } from '../components/TableExportControl';
import { 
  saveSecuritySession, 
  loadSecuritySession, 
  clearSecuritySession, 
  type TablePaginationState 
} from '../services/securitySessionService';

// Global in-memory cache of investigation snapshots for seamless same-browser child tab access
const globalInvestigationSnapshots = new Map<string, any>();
(window as any).__oracleInvestigationSnapshots = globalInvestigationSnapshots;

if (typeof BroadcastChannel !== 'undefined') {
  try {
    const channel = new BroadcastChannel('oracle_investigation_channel');
    channel.onmessage = (event) => {
      if (event.data?.type === 'REQUEST_SNAPSHOT' && event.data?.id) {
        const found = globalInvestigationSnapshots.get(event.data.id);
        if (found) {
          channel.postMessage({ type: 'SNAPSHOT_DATA', id: event.data.id, payload: found });
        }
      }
    };
  } catch (_) {}
}

function ChatLoader() {
  const [stage, setStage] = useState(0);
  const stages = [
    'Understanding your security query...',
    'Connecting to Oracle Fusion API...',
    'Analyzing security data and privileges...',
    'Preparing compliance results...'
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setStage(prev => (prev < 3 ? prev + 1 : prev));
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.5rem 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--accent-blue)', animation: 'spin 2s linear infinite' }} />
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
          {stages[stage]}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', opacity: 0.5 }}>
        <div style={{ height: '12px', width: '95%' }} className="skeleton" />
        <div style={{ height: '12px', width: '75%' }} className="skeleton" />
      </div>
    </div>
  );
}

interface Message {
  sender: 'user' | 'assistant';
  text: string;
  intent?: string;
  parameters?: any;
  toolResult?: any;
  structuredData?: any;
  loading?: boolean;
}

interface AssistantProps {
  currentUser?: string;
  initialQuestion?: string;
  clearInitialQuestion?: () => void;
  environmentMode: 'DEMO' | 'ORACLE_FUSION';
  onNavigatePage: (pageId: string, filter?: string) => void;
  onInvestigate: (type: 'role' | 'user', id: string, name: string, initialTab?: string) => void;
  onOpenFullInvestigation?: (investigationId: string, payload?: any) => void;
}

export default function Assistant({ 
  currentUser = '',
  initialQuestion, 
  clearInitialQuestion, 
  environmentMode,
  onNavigatePage,
  onInvestigate,
  onOpenFullInvestigation
}: AssistantProps) {
  // Try restoring saved session from sessionStorage on mount
  const savedSession = React.useMemo(() => {
    return currentUser ? loadSecuritySession(currentUser) : null;
  }, [currentUser]);

  const [messages, setMessages] = useState<Message[]>(() => {
    if (savedSession && savedSession.messages && savedSession.messages.length > 0) {
      return savedSession.messages;
    }
    return [
      {
        sender: 'assistant',
        text: "Welcome to the Oracle Fusion Security & Risk Intelligence Assistant. I am configured to answer compliance questions regarding roles, users, and audit trail changes.\n\nWhat security information can I help you extract today?"
      }
    ];
  });
  const [inputValue, setInputValue] = useState(() => savedSession?.inputValue || '');
  const [tableStates, setTableStates] = useState<Record<number, TablePaginationState>>(() => savedSession?.tableStates || {});
  const [rolesListStates, setRolesListStates] = useState<Record<number, { currentPage: number }>>(() => savedSession?.rolesListStates || {});
  const [expandedDetails, setExpandedDetails] = useState<Record<number, boolean>>(() => savedSession?.expandedDetails || {});
  const currentScrollTopRef = useRef<number>(savedSession?.scrollTop || 0);
  const isInitialRestoreRef = useRef<boolean>(true);

  const [sending, setSending] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestAssistantMsgRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);

  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const [highlightedMsgIndex, setHighlightedMsgIndex] = useState<number | null>(null);
  const historyDropdownRef = useRef<HTMLDivElement>(null);

  // Close history dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (historyDropdownRef.current && !historyDropdownRef.current.contains(event.target as Node)) {
        setShowHistoryDropdown(false);
      }
    }
    if (showHistoryDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showHistoryDropdown]);

  // Compute questions asked during current 24-hour retention period
  const recentQueries = React.useMemo(() => {
    return messages
      .map((m, idx) => ({ text: m.text, index: idx }))
      .filter(item => messages[item.index].sender === 'user' && item.text && typeof item.text === 'string');
  }, [messages]);

  const handleSelectHistoryQuestion = (targetIndex: number, text: string) => {
    setShowHistoryDropdown(false);
    setHighlightedMsgIndex(targetIndex);
    setTimeout(() => {
      const el = document.getElementById(`chat-msg-${targetIndex}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);
    setTimeout(() => setHighlightedMsgIndex(null), 3000);
  };

  const handleClearHistory = () => {
    clearSecuritySession(currentUser);
    setMessages([
      {
        sender: 'assistant',
        text: "Welcome to the Oracle Fusion Security & Risk Intelligence Assistant. I am configured to answer compliance questions regarding roles, users, and audit trail changes.\n\nWhat security information can I help you extract today?"
      }
    ]);
    setTableStates({});
    setRolesListStates({});
    setExpandedDetails({});
    setInputValue('');
    setShowHistoryDropdown(false);
  };

  // Rehydrate saved 24-hour session if currentUser becomes available after initial mount
  useEffect(() => {
    if (!currentUser) return;
    const session = loadSecuritySession(currentUser);
    if (session && session.messages && session.messages.length > 1) {
      setMessages(session.messages);
      if (session.tableStates) setTableStates(session.tableStates);
      if (session.rolesListStates) setRolesListStates(session.rolesListStates);
      if (session.expandedDetails) setExpandedDetails(session.expandedDetails);
      if (session.inputValue) setInputValue(session.inputValue);
    }
  }, [currentUser]);

  // Show hero search only before the user starts chatting
  const showCommandCenter = messages.length <= 1 && !sending;

  // Auto-focus helper
  React.useLayoutEffect(() => {
    if (showCommandCenter) {
      commandInputRef.current?.focus();
    } else {
      if (chatInputRef.current) {
        chatInputRef.current.focus();
        const len = chatInputRef.current.value.length;
        chatInputRef.current.setSelectionRange(len, len);
      }
    }
  }, [showCommandCenter]);

  // Restore scroll position on initial load if returning to an active session
  useEffect(() => {
    if (isInitialRestoreRef.current) {
      isInitialRestoreRef.current = false;
      if (savedSession?.scrollTop && chatContainerRef.current) {
        chatContainerRef.current.scrollTop = savedSession.scrollTop;
      }
    }
  }, [savedSession]);

  // Auto-scroll chat to the top of the newest assistant message so users see the answer from the start
  useEffect(() => {
    if (isInitialRestoreRef.current) return;
    if (messages.length > 1) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.sender === 'assistant') {
        latestAssistantMsgRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages]);

  // Persist session snapshot to sessionStorage whenever investigation state updates
  useEffect(() => {
    if (!currentUser) return;
    if (messages.length === 1 && !inputValue && Object.keys(tableStates).length === 0) {
      return;
    }
    saveSecuritySession(currentUser, {
      messages,
      tableStates,
      rolesListStates,
      expandedDetails,
      inputValue,
      scrollTop: currentScrollTopRef.current
    });
  }, [currentUser, messages, tableStates, rolesListStates, expandedDetails, inputValue]);

  // Suggested reusable question templates for quick follow-up in active chat
  const suggestedTemplates = [
    "Who has the <role name> role?",
    "Which roles are assigned to <username>?",
    "What privileges does <role name> have?",
    "Show recent security changes.",
    "Show users with high-risk role assignments."
  ];

  // Professional question catalog categories for the AI Investigation Workspace
  const questionCategories = [
    {
      category: 'USERS & ROLES',
      icon: Users,
      color: 'var(--accent-blue)',
      questions: [
        'Who has the <role name> role?',
        'Which roles are assigned to <username>?',
        'Does <username> have a <role type> role?',
        'Show users with multiple role assignments.'
      ]
    },
    {
      category: 'PRIVILEGES & ACCESS',
      icon: Shield,
      color: 'var(--accent-purple)',
      questions: [
        'What privileges does <role name> have?',
        'What roles grant access to <privilege>?',
        'Show role hierarchy for <role name>.',
        'Which users have <privilege>?'
      ]
    },
    {
      category: 'AUDIT & CHANGES',
      icon: FileText,
      color: 'var(--accent-amber)',
      questions: [
        'Show recent security changes.',
        'What security changes affect <username>?',
        'Show recent role assignment changes.',
        'Show audit history for <role name>.'
      ]
    },
    {
      category: 'ANALYTICS',
      icon: Database,
      color: '#10b981',
      questions: [
        'How many users are in the environment?',
        'Which roles have the most users?',
        'Show users without assigned roles.'
      ]
    },
    {
      category: 'RISK & COMPLIANCE',
      icon: ShieldAlert,
      color: 'var(--accent-red)',
      questions: [
        'Show users with high-risk role assignments.',
        'Which users have potential segregation-of-duties risks?',
        'Show recent risk violations.'
      ]
    }
  ];

  // Populate template into input field and set focus without autosubmitting, selecting placeholder for instant editing
  const handleApplyTemplate = (template: string) => {
    setInputValue(template);
    setTimeout(() => {
      const inputEl = showCommandCenter ? commandInputRef.current : chatInputRef.current;
      if (inputEl) {
        inputEl.focus();
        // Detect first <placeholder> to select it for instant replacement
        const match = template.match(/<[^>]+>/);
        if (match && match.index !== undefined) {
          inputEl.setSelectionRange(match.index, match.index + match[0].length);
        } else {
          inputEl.setSelectionRange(template.length, template.length);
        }
      }
    }, 50);
  };

  // Helper to render template text with visually distinct placeholders
  const renderTemplateText = (text: string) => {
    const parts = text.split(/(<[^>]+>)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('<') && part.endsWith('>')) {
        return (
          <span
            key={idx}
            style={{
              color: '#2563EB',
              backgroundColor: '#EFF6FF',
              padding: '0.08rem 0.35rem',
              borderRadius: '4px',
              fontWeight: 600,
              fontFamily: 'monospace',
              fontSize: '0.78rem',
              border: '1px solid #DBEAFE',
              margin: '0 0.15rem',
              display: 'inline-block'
            }}
          >
            {part}
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  // Handle template question selection from dashboard or external trigger - populate and focus, DO NOT AUTOSUBMIT
  useEffect(() => {
    if (initialQuestion) {
      setInputValue(initialQuestion);
      if (clearInitialQuestion) clearInitialQuestion();
      setTimeout(() => {
        const inputEl = showCommandCenter ? commandInputRef.current : chatInputRef.current;
        if (inputEl) {
          inputEl.focus();
          const match = initialQuestion.match(/<[^>]+>/);
          if (match && match.index !== undefined) {
            inputEl.setSelectionRange(match.index, match.index + match[0].length);
          } else {
            inputEl.setSelectionRange(initialQuestion.length, initialQuestion.length);
          }
        }
      }, 50);
    }
  }, [initialQuestion, showCommandCenter]);

  const handleSend = async (textToSend: string) => {
    const text = textToSend.trim();
    if (!text) return;

    // Check if user is typing a direct role/user name search in command bar
    // e.g. "AP Manager" or "JSMITH". We can route to NLU first, but let's allow NLU to handle it.
    
    // Add user message
    setMessages(prev => [...prev, { sender: 'user', text }]);
    setInputValue('');
    setSending(true);

    // Add temporary loading bubble
    setMessages(prev => [...prev, { sender: 'assistant', text: '', loading: true }]);

    try {
      const response = await api.sendMessage(text);
      
      // Replace loading bubble with real response
      setMessages(prev => {
        const list = [...prev];
        list.pop(); // remove loading message
        return [...list, {
          sender: 'assistant',
          text: response.message,
          intent: response.intent,
          parameters: response.parameters,
          toolResult: response.toolResult,
          structuredData: response.structuredData
        }];
      });
    } catch (err) {
      console.error('Chat error:', err);
      
      setMessages(prev => {
        const list = [...prev];
        list.pop();
        return [...list, {
          sender: 'assistant',
          text: "Connection failed. Please verify that your backend Express server is running and accessible.",
          toolResult: {
            success: false,
            error: (err as Error).message || 'Express offline'
          }
        }];
      });
    } finally {
      setSending(false);
    }
  };

  const handleEditAndResubmit = async (index: number, newText: string) => {
    const text = newText.trim();
    if (!text) return;

    setSending(true);
    setEditingIndex(null);

    // Truncate messages after index, and update message at index
    setMessages(prev => {
      const updated = prev.slice(0, index + 1);
      updated[index] = { ...updated[index], text };
      // Append temporary loading bubble
      return [...updated, { sender: 'assistant', text: '', loading: true }];
    });

    try {
      const response = await api.sendMessage(text);
      setMessages(prev => {
        const list = [...prev];
        list.pop(); // remove loading message
        return [...list, {
          sender: 'assistant',
          text: response.message,
          intent: response.intent,
          parameters: response.parameters,
          toolResult: response.toolResult,
          structuredData: response.structuredData
        }];
      });
    } catch (err) {
      console.error('Chat error during resubmit:', err);
      setMessages(prev => {
        const list = [...prev];
        list.pop();
        return [...list, {
          sender: 'assistant',
          text: "Connection failed. Please verify that your backend Express server is running and accessible.",
          toolResult: {
            success: false,
            error: (err as Error).message || 'Express offline'
          }
        }];
      });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(inputValue);
    }
  };

  const clearChat = () => {
    if (currentUser) {
      clearSecuritySession(currentUser);
    }
    setMessages([
      {
        sender: 'assistant',
        text: "Welcome to the Oracle Fusion Security & Risk Intelligence Assistant. I am configured to answer compliance questions regarding roles, users, and audit trail changes.\n\nWhat security information can I help you extract today?"
      }
    ]);
    setInputValue('');
    setTableStates({});
    setRolesListStates({});
    setExpandedDetails({});
    currentScrollTopRef.current = 0;
  };

  const renderStructuredData = (structured: any, msg: Message, index: number) => {
    if (!structured) return null;

    const { title, summary, keyFindings, riskHighlights, table, actions, metadata, user } = structured;

    return (
      <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        
        {/* Investigation Header */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent-blue)', textTransform: 'uppercase' }}>
            <Shield size={13} style={{ strokeWidth: 2.5 }} />
            <span>Oracle Risk Intelligence Assistant</span>
          </div>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
            {title}
          </h3>
        </div>

        {/* Primary Data: User Security Profile Custom Presentation (Cards Render First) */}
        {user && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem', marginBottom: '0.5rem' }}>
            
            {msg.intent === 'GET_USER' && (
              <div className="glass-panel" style={{ padding: '1rem', backgroundColor: 'var(--bg-tertiary)' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{user.displayName}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', fontSize: '0.8rem' }}>
                  <code>{user.userName}</code>
                  <span style={{ color: 'var(--text-muted)' }}>•</span>
                  <span className={`badge ${user.active ? 'badge-active' : 'badge-inactive'}`} style={{ fontSize: '0.65rem' }}>
                    {user.active ? 'Active' : 'Inactive'}
                  </span>
                  {user.email && (
                    <>
                      <span style={{ color: 'var(--text-muted)' }}>•</span>
                      <span>{user.email}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {user.filteredRoleCategory
                ? `Assigned ${user.filteredRoleCategory} Roles (${user.assignedRoles?.length || 0})`
                : (msg.intent === 'ROLES_BY_USER' ? `Assigned Security Roles (${user.assignedRoles?.length || 0})` : 'Assigned Roles Preview')}
            </div>

            {user.assignedRoles && user.assignedRoles.length > 0 ? (
              <AssignedRolesList 
                roles={user.assignedRoles} 
                onInvestigate={onInvestigate}
                onInspectRole={(roleName) => onInvestigate('role', roleName, roleName)} 
                initialPage={rolesListStates[index]?.currentPage ?? 1}
                onPageChange={(page) => {
                  setRolesListStates(prev => ({
                    ...prev,
                    [index]: { currentPage: page }
                  }));
                }}
              />
            ) : (
              <div className="glass-panel" style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {user.filteredRoleCategory
                  ? `No matching roles found. User ${user.displayName || user.userName} does not have any assigned ${user.filteredRoleCategory.charAt(0) + user.filteredRoleCategory.slice(1).toLowerCase()} Roles.`
                  : 'No assigned roles were returned for this user.'}
              </div>
            )}
          </div>
        )}

        {/* Ambiguous Role Matches Selection */}
        {structured.ambiguous && structured.matches && structured.matches.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem', marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              Did you mean one of these roles? Click to inspect:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxWidth: '400px' }}>
              {structured.matches.map((match: any, idx: number) => (
                <button
                  key={idx}
                  onClick={() => {
                    onInvestigate('role', match.roleCode || match.roleName, match.roleName);
                  }}
                  className="btn btn-secondary"
                  style={{
                    textAlign: 'left',
                    padding: '0.5rem 1rem',
                    fontSize: '0.8rem',
                    backgroundColor: 'var(--bg-secondary)',
                    borderColor: 'var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{match.roleName}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{match.roleCode}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Dynamic Interactive Paginated Table */}
        {table && table.rows && table.rows.length > 0 && !structured.briefingRaw && !user && !structured.ambiguous && (
          <PaginatedTable 
            table={table}
            metadata={metadata}
            onNavigatePage={onNavigatePage}
            onInvestigate={onInvestigate}
            onInspectRole={(roleName) => onInvestigate('role', roleName, roleName)}
            initialPage={tableStates[index]?.currentPage ?? 1}
            initialPageSize={tableStates[index]?.pageSize ?? 10}
            initialFilterText={tableStates[index]?.filterText ?? ''}
            onStateChange={(tblState) => {
              setTableStates(prev => ({
                ...prev,
                [index]: tblState
              }));
            }}
          />
        )}

        {/* Role Briefing Custom Presentation (Briefing Details Render First) */}
        {structured.briefingRaw && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.25rem' }}>
            {structured.role && (
              <div className="glass-panel" style={{ padding: '1rem', backgroundColor: 'var(--bg-tertiary)' }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Role: <span style={{ color: 'var(--accent-blue)' }}>{structured.role.name}</span> ({structured.role.code})</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>Category: {structured.role.category}</div>
              </div>
            )}
            
            {structured.summary && (
              <div style={{ display: 'flex', gap: '1.5rem', padding: '0.25rem 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <div>Total Privileges: <strong>{structured.summary.totalPrivileges}</strong></div>
                <div>Direct: <strong>{structured.summary.directPrivileges}</strong></div>
                <div>Inherited: <strong>{structured.summary.inheritedPrivileges}</strong></div>
              </div>
            )}

            {/* Render Briefing Text segments */}
            {typeof structured.briefingRaw === 'string' ? (
              <div className="glass-panel" style={{ padding: '1rem', fontSize: '0.85rem', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                {structured.briefingRaw}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {structured.briefingRaw.roleSummary && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Role Summary</div>
                    <div className="glass-panel" style={{ padding: '0.85rem', fontSize: '0.85rem', lineHeight: '1.45', whiteSpace: 'pre-wrap' }}>
                      {structured.briefingRaw.roleSummary}
                    </div>
                  </div>
                )}
                {structured.briefingRaw.roleUsage && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Access & Role Usage</div>
                    <div className="glass-panel" style={{ padding: '0.85rem', fontSize: '0.85rem', lineHeight: '1.45', whiteSpace: 'pre-wrap' }}>
                      {structured.briefingRaw.roleUsage}
                    </div>
                  </div>
                )}
                {structured.briefingRaw.certificationHistory && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Certification & Audit History</div>
                    <div className="glass-panel" style={{ padding: '0.85rem', fontSize: '0.85rem', lineHeight: '1.45', whiteSpace: 'pre-wrap' }}>
                      {structured.briefingRaw.certificationHistory}
                    </div>
                  </div>
                )}
                {structured.briefingRaw.privileges && (
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Privilege Overview</div>
                    <div className="glass-panel" style={{ padding: '0.85rem', fontSize: '0.85rem', lineHeight: '1.45', whiteSpace: 'pre-wrap' }}>
                      {structured.briefingRaw.privileges}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {actions && actions.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
            {actions.map((act: any, idx: number) => (
              <button
                key={idx}
                onClick={() => {
                  if (act.actionType === 'NAVIGATE') {
                    onNavigatePage(act.params.page, act.params.filter);
                  } else if (act.actionType === 'INVESTIGATE') {
                    onInvestigate(act.params.type, act.params.id, act.params.name, act.params.initialTab);
                  }
                }}
                className="btn btn-secondary"
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.75rem',
                  backgroundColor: 'var(--bg-secondary)',
                  borderColor: 'var(--border-color)'
                }}
              >
                <span>{act.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* AI Security Insights (Rendered Second) */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            AI Security Insights & Executive Summary
          </span>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', lineHeight: '1.45', fontWeight: 500 }}>
            {summary}
          </div>
          {keyFindings && keyFindings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', paddingLeft: '0.5rem', marginTop: '0.25rem' }}>
              {keyFindings.map((finding: string, idx: number) => (
                <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.85rem' }}>
                  <CornerDownRight size={14} style={{ color: 'var(--accent-blue)', marginTop: '0.2rem', flexShrink: 0 }} />
                  <span style={{ color: 'var(--text-secondary)' }}>{finding}</span>
                </div>
              ))}
            </div>
          )}
          {riskHighlights && riskHighlights.length > 0 && (
            <div style={{
              marginTop: '0.25rem',
              padding: '0.75rem 1rem',
              backgroundColor: 'rgba(239, 68, 68, 0.04)',
              borderLeft: '3px solid var(--accent-red)',
              borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-red)', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                <ShieldAlert size={14} />
                <span>Risk Warning</span>
              </div>
              {riskHighlights.map((highlight: string, idx: number) => (
                <p key={idx} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                  {highlight}
                </p>
              ))}
            </div>
          )}
        </div>

      </div>
    );
  };

  const renderErrorCard = (toolResult: any) => {
    const errorText = toolResult?.error || 'Unable to retrieve the requested Oracle Fusion data.';
    
    let categoryTitle = 'Oracle Query Interrupted';
    let displayMessage = errorText;
    let showSettingsButton = false;

    // Check if it signature maps to different scenarios
    if (errorText.toLowerCase().includes('integration required') || errorText.toLowerCase().includes('not supported under default')) {
      categoryTitle = 'Oracle API Integration Missing';
      displayMessage = errorText;
      showSettingsButton = true;
    } else if (errorText.toLowerCase().includes('authenticate') || errorText.toLowerCase().includes('credentials') || errorText.toLowerCase().includes('401')) {
      categoryTitle = 'Oracle Authentication Failure';
      displayMessage = 'Oracle Fusion connection rejected. Please verify that your credentials configurations in Settings are correct.';
      showSettingsButton = true;
    } else if (errorText.toLowerCase().includes('privileges') || errorText.toLowerCase().includes('forbidden') || errorText.toLowerCase().includes('403')) {
      categoryTitle = 'Oracle Permission Denied';
      displayMessage = 'Access denied. The configured integration account does not have sufficient privileges to read this security data.';
      showSettingsButton = true;
    } else if (errorText.toLowerCase().includes('provisioned') || errorText.toLowerCase().includes('licensed separately')) {
      categoryTitle = 'Oracle Service Not Provisioned';
      displayMessage = errorText;
      showSettingsButton = false;
    } else if (errorText.toLowerCase().includes('unreachable') || errorText.toLowerCase().includes('timeout') || errorText.toLowerCase().includes('timed out')) {
      categoryTitle = 'Oracle Host Unreachable';
      displayMessage = 'Connection timed out. Please check your network connection and verify that the Oracle instance is online.';
      showSettingsButton = true;
    }

    return (
      <div style={{
        marginTop: '0.75rem',
        padding: '1rem',
        backgroundColor: 'rgba(239, 68, 68, 0.04)',
        border: '1px dashed var(--accent-red)',
        borderRadius: 'var(--radius-md)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-red)', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
          <AlertTriangle size={16} />
          <span>{categoryTitle}</span>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.45', margin: '0 0 0.75rem 0' }}>
          {displayMessage}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button 
            onClick={() => {
              const userMsgs = messages.filter(m => m.sender === 'user');
              if (userMsgs.length > 0) {
                handleSend(userMsgs[userMsgs.length - 1].text);
              }
            }}
            className="btn btn-secondary" 
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
          >
            Retry Query
          </button>
          {showSettingsButton && (
            <button 
              onClick={() => onNavigatePage('settings')}
              className="btn btn-secondary" 
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
            >
              Check Connection Settings
            </button>
          )}
        </div>
      </div>
    );
  };

  // Render clickable links or tables in chat
  const renderRichData = (result: any, intent: string) => {
    if (!result || !result.success || !result.data) return null;
    
    const data = result.data;

    if (result.integrationRequired) {
      return (
        <div style={{
          marginTop: '1rem',
          padding: '1rem',
          backgroundColor: 'rgba(217, 119, 6, 0.04)',
          border: '1px dashed var(--accent-gold)',
          borderRadius: 'var(--radius-md)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-gold)', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
            <AlertTriangle size={16} />
            <span>Integration Required</span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
            {data.message || 'This tool requires a custom Oracle Fusion API mapping.'}
          </p>
        </div>
      );
    }

    switch (intent) {
      case 'LIST_USERS':
      case 'USERS_BY_ROLE':
        if (Array.isArray(data)) {
          return (
            <div className="table-container" style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.35rem 0.5rem', backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-subtle)' }}>
                <TableExportControl
                  filename="assistant_users"
                  data={data}
                  totalCount={data.length}
                  columns={[
                    { key: 'displayName', label: 'Display Name' },
                    { key: 'userName', label: 'Username' },
                    { key: 'status', label: 'Status', getValue: (u: any) => u.active ? 'Active' : 'Inactive' }
                  ]}
                />
              </div>
              <table className="enterprise-table" style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th>Display Name</th>
                    <th>Username</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.slice(0, 10).map((u: any, idx: number) => (
                    <tr key={u.id || idx}>
                      <td style={{ fontWeight: 600 }}>{u.displayName}</td>
                      <td><code>{u.userName}</code></td>
                      <td>
                        <span className={`badge ${u.active ? 'badge-active' : 'badge-inactive'}`}>
                          {u.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <button 
                          onClick={() => onInvestigate('user', u.userName, u.displayName)}
                          className="btn btn-secondary" 
                          style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }}
                        >
                          Investigate
                        </button>
                      </td>
                    </tr>
                  ))}
                  {data.length > 10 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        Showing first 10 of {data.length} users. Explore Users List to see all.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        }
        break;

      case 'ROLES_BY_USER':
      case 'GET_USER':
        if (data.displayName) {
          return (
            <div className="glass-panel" style={{ marginTop: '0.75rem', padding: '1rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                  {data.displayName}
                </div>
                <button 
                  onClick={() => onInvestigate('user', data.userName, data.displayName)}
                  className="btn btn-secondary" 
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                >
                  Deep Investigation Workspace
                </button>
              </div>
              <div style={{ color: 'var(--text-secondary)', margin: '0.5rem 0' }}>
                Username: <code>{data.userName}</code> | Status:{' '}
                <span className={`badge ${data.active ? 'badge-active' : 'badge-inactive'}`}>
                  {data.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Assigned Security Roles ({data.assignedRoles?.length || 0}):</div>
              {data.assignedRoles?.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
                  {data.assignedRoles.map((role: string, idx: number) => (
                    <span 
                      key={idx} 
                      onClick={() => onInvestigate('role', role.toUpperCase().replace(/\s+/g, '_'), role)}
                      className="badge badge-gold" 
                      style={{ fontSize: '0.75rem', cursor: 'pointer' }}
                    >
                      {role}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No roles assigned.</div>
              )}
            </div>
          );
        }
        break;

      case 'LIST_ROLES':
      case 'ROLE_SEARCH':
      case 'GET_ROLE':
      case 'ROLE_DETAILS':
        if (Array.isArray(data)) {
          return (
            <div className="table-container" style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.35rem 0.5rem', backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-subtle)' }}>
                <TableExportControl
                  filename="assistant_roles"
                  data={data}
                  totalCount={data.length}
                  columns={[
                    { key: 'category', label: 'Category' },
                    { key: 'roleCode', label: 'Role Code' },
                    { key: 'displayName', label: 'Display Name' }
                  ]}
                />
              </div>
              <table className="enterprise-table" style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Role Code</th>
                    <th>Display Name</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.slice(0, 10).map((r: any, idx: number) => (
                    <tr key={r.id || idx}>
                      <td><span className="badge badge-blue">{r.category}</span></td>
                      <td><code>{r.roleCode}</code></td>
                      <td style={{ fontWeight: 600 }}>{r.displayName}</td>
                      <td>
                        <button 
                          onClick={() => onInvestigate('role', r.roleCode, r.displayName)}
                          className="btn btn-secondary" 
                          style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }}
                        >
                          Investigate
                        </button>
                      </td>
                    </tr>
                  ))}
                  {data.length > 10 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        Showing first 10 of {data.length} roles. Explore Roles Catalog for full list.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        }
        break;

      case 'AUDIT_HISTORY':
        if (Array.isArray(data)) {
          return (
            <div className="table-container" style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.35rem 0.5rem', backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-subtle)' }}>
                <TableExportControl
                  filename="assistant_audit"
                  data={data}
                  totalCount={data.length}
                  columns={[
                    { key: 'timestamp', label: 'Timestamp', getValue: (a: any) => a.timestamp ? new Date(a.timestamp).toLocaleString() : '' },
                    { key: 'username', label: 'User' },
                    { key: 'businessObject', label: 'Object' },
                    { key: 'action', label: 'Action', getValue: (a: any) => a.action || a.event || 'UPDATE' },
                    { key: 'details', label: 'Details' }
                  ]}
                />
              </div>
              <table className="enterprise-table" style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>User</th>
                    <th>Object</th>
                    <th>Action</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.slice(0, 10).map((a: any, idx: number) => (
                    <tr key={a.id || idx}>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                        {new Date(a.timestamp).toLocaleString()}
                      </td>
                      <td style={{ fontWeight: 600 }}><code>{a.username}</code></td>
                      <td>{a.businessObject}</td>
                      <td>
                        <span className={`badge ${a.action === 'ROLE_REVOKE' ? 'badge-inactive' : a.action === 'ROLE_ASSIGN' ? 'badge-active' : 'badge-gold'}`}>
                          {a.action || a.event || 'UPDATE'}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: '200px' }}>{a.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        break;

      case 'ROLE_HIERARCHY':
        if (data.hierarchy) {
          const renderNode = (node: any, depth = 0) => (
            <div key={node.code} style={{ marginLeft: `${depth * 1.5}rem`, marginTop: '0.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                {depth > 0 && <CornerDownRight size={12} style={{ color: 'var(--text-muted)' }} />}
                <span style={{ fontWeight: depth === 0 ? 700 : 500 }}>{node.name}</span>
                <code style={{ fontSize: '0.7rem' }}>({node.code})</code>
                <span className="badge badge-blue" style={{ fontSize: '0.6rem', padding: '0.1rem 0.3rem' }}>{node.category}</span>
              </div>
              {node.children?.map((child: any) => renderNode(child, depth + 1))}
            </div>
          );
          return (
            <div className="glass-panel" style={{ marginTop: '0.75rem', padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Role Hierarchy Tree:</div>
                <button 
                  onClick={() => onInvestigate('role', data.roleCode, data.roleName)}
                  className="btn btn-secondary" 
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}
                >
                  Workspace Details
                </button>
              </div>
              {renderNode(data.hierarchy)}
            </div>
          );
        }
        break;

      case 'ROLE_PRIVILEGES':
        if (Array.isArray(data.privileges)) {
          return (
            <div className="table-container" style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.35rem 0.5rem', backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-subtle)' }}>
                <TableExportControl
                  filename="assistant_privileges"
                  data={data.privileges}
                  totalCount={data.privileges.length}
                  columns={[
                    { key: 'name', label: 'Privilege Name' },
                    { key: 'code', label: 'Code' },
                    { key: 'inheritedFrom', label: 'Inherited From' }
                  ]}
                />
              </div>
              <table className="enterprise-table" style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th>Privilege Name</th>
                    <th>Code</th>
                    <th>Inherited From</th>
                  </tr>
                </thead>
                <tbody>
                  {data.privileges.slice(0, 15).map((p: any, idx: number) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td><code>{p.code}</code></td>
                      <td style={{ color: 'var(--text-secondary)' }}>{p.inheritedFrom}</td>
                    </tr>
                  ))}
                  {data.privileges.length > 15 && (
                    <tr>
                      <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        Showing first 15 of {data.privileges.length} privileges.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        }
        break;

      default:
        return null;
    }
  };  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 'calc(100vh - 70px)' }}>
      
      {showCommandCenter ? (
        // ====================================================
        // ASK VEYRA HERO AI INVESTIGATION WORKSPACE
        // ====================================================
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: 'var(--bg-primary)' }} className="animate-fade-in">
          
          {/* Top Blue Gradient Hero Section */}
          <div className="hero-gradient-header" style={{
            padding: '3.5rem 1.5rem 4.5rem 1.5rem',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            background: 'linear-gradient(135deg, #1E40AF 0%, #2563EB 55%, #60A5FA 100%)'
          }}>
            
            {/* Elegant SVG Wave Curves Background (Strictly no dots or spheres) */}
            <svg 
              viewBox="0 0 1440 320" 
              preserveAspectRatio="none" 
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 1,
                opacity: 0.95
              }}
            >
              <defs>
                <linearGradient id="waveCurve1" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.07" />
                  <stop offset="100%" stopColor="#93C5FD" stopOpacity="0.18" />
                </linearGradient>
                <linearGradient id="waveCurve2" x1="100%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.05" />
                  <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.14" />
                </linearGradient>
                <linearGradient id="waveCurve3" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0.04" />
                </linearGradient>
              </defs>
              <path fill="url(#waveCurve1)" d="M0,160 C320,260,480,80,800,180 C1120,280,1280,120,1440,160 L1440,320 L0,320 Z" />
              <path fill="url(#waveCurve2)" d="M0,220 C360,120,600,280,960,190 C1200,130,1360,240,1440,210 L1440,320 L0,320 Z" />
              <path fill="url(#waveCurve3)" d="M0,90 C280,180,560,40,900,120 C1200,190,1350,80,1440,110 L1440,320 L0,320 Z" />
            </svg>

            {/* Hero Foreground Content */}
            <div style={{ position: 'relative', zIndex: 2, maxWidth: '840px', width: '100%', margin: '0 auto' }}>
              
              {/* Badge: AI-Powered Security Intelligence */}
              <div style={{ 
                display: 'inline-flex', 
                alignItems: 'center', 
                gap: '0.5rem', 
                padding: '0.4rem 1.1rem', 
                borderRadius: '9999px', 
                backgroundColor: 'rgba(255, 255, 255, 0.15)', 
                border: '1px solid rgba(255, 255, 255, 0.25)', 
                marginBottom: '1.25rem',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.05)'
              }}>
                <Sparkles size={15} style={{ color: '#ffffff' }} />
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#ffffff', letterSpacing: '0.02em' }}>
                  AI-Powered Security Intelligence
                </span>
              </div>

              {/* Title */}
              <h1 style={{ 
                fontSize: '2.85rem', 
                fontWeight: 800, 
                fontFamily: 'var(--font-header)', 
                color: '#ffffff', 
                letterSpacing: '-0.025em', 
                marginBottom: '0.65rem',
                lineHeight: 1.15
              }}>
                Ask VEYRA
              </h1>

              {/* Subtitle */}
              <p style={{ 
                color: '#E0E7FF', 
                fontSize: '1.05rem', 
                maxWidth: '680px', 
                margin: '0 auto 2rem auto', 
                lineHeight: 1.5,
                fontWeight: 400
              }}>
                Ask questions about your connected enterprise security, access, audit, and risk data.
              </p>

              {/* Prominent White Rounded Search Bar */}
              <div style={{ 
                position: 'relative', 
                display: 'flex', 
                alignItems: 'center', 
                backgroundColor: '#ffffff',
                borderRadius: '9999px',
                padding: '0.45rem 0.65rem 0.45rem 1.4rem',
                boxShadow: '0 14px 38px -4px rgba(30, 64, 175, 0.3), 0 4px 14px rgba(0, 0, 0, 0.08)',
                width: '100%',
                maxWidth: '820px',
                margin: '0 auto',
                transition: 'all 0.2s ease',
                border: '1px solid rgba(255, 255, 255, 0.8)'
              }}>
                <span style={{ color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', marginRight: '0.85rem' }}>
                  <Search size={22} strokeWidth={2.2} />
                </span>

                <input
                  ref={commandInputRef}
                  type="text"
                  style={{ 
                    flex: 1,
                    height: '46px', 
                    fontSize: '1rem', 
                    border: 'none',
                    outline: 'none',
                    backgroundColor: 'transparent',
                    color: '#0F172A',
                    fontFamily: 'var(--font-main)',
                    minWidth: 0
                  }}
                  placeholder='Ask VEYRA anything about your environment (e.g., "Who has the Supplier Manager role?")...'
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend(inputValue)}
                />

                {/* History Trigger button if previous queries exist */}
                {recentQueries.length > 0 && (
                  <div ref={historyDropdownRef} style={{ position: 'relative', marginRight: '0.5rem' }}>
                    <button
                      onClick={() => setShowHistoryDropdown(prev => !prev)}
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.35rem 0.65rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        cursor: 'pointer',
                        borderRadius: '20px',
                        border: '1px solid #E2E8F0',
                        backgroundColor: '#F8FAFC',
                        color: '#64748B',
                        fontWeight: 600
                      }}
                      title="View questions asked in the past 24 hours"
                    >
                      <History size={13} style={{ color: 'var(--accent-blue)' }} />
                      <span>{recentQueries.length}</span>
                      <ChevronDown size={12} />
                    </button>

                    {showHistoryDropdown && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '0.6rem',
                        width: '340px',
                        maxWidth: '90vw',
                        backgroundColor: '#ffffff',
                        border: '1px solid #E2E8F0',
                        borderRadius: '16px',
                        boxShadow: '0 16px 36px -4px rgba(15, 23, 42, 0.15)',
                        zIndex: 1000,
                        padding: '0.85rem',
                        textAlign: 'left'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E2E8F0', paddingBottom: '0.5rem', marginBottom: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 700, color: '#0F172A' }}>
                            <Clock size={13} style={{ color: 'var(--accent-blue)' }} />
                            <span>Recent Questions ({recentQueries.length})</span>
                          </div>
                          <button
                            onClick={handleClearHistory}
                            style={{
                              fontSize: '0.7rem',
                              padding: '0.2rem 0.5rem',
                              color: '#EF4444',
                              border: '1px solid rgba(239, 68, 68, 0.25)',
                              borderRadius: '6px',
                              backgroundColor: 'transparent',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem',
                              cursor: 'pointer'
                            }}
                          >
                            <Trash2 size={11} />
                            <span>Clear</span>
                          </button>
                        </div>
                        <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          {recentQueries.map((q, idx) => (
                            <div
                              key={idx}
                              onClick={() => handleSelectHistoryQuestion(q.index, q.text)}
                              style={{
                                padding: '0.5rem 0.65rem',
                                borderRadius: '8px',
                                fontSize: '0.78rem',
                                color: '#475569',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#EFF6FF';
                                e.currentTarget.style.color = '#2563EB';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = '#475569';
                              }}
                            >
                              • {q.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Circular Blue Submit Button with ArrowUp */}
                <button 
                  onClick={() => handleSend(inputValue)}
                  disabled={!inputValue.trim() || sending}
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: inputValue.trim() ? '#2563EB' : '#E2E8F0',
                    color: inputValue.trim() ? '#ffffff' : '#94A3B8',
                    border: 'none',
                    cursor: inputValue.trim() ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s ease',
                    flexShrink: 0,
                    boxShadow: inputValue.trim() ? '0 4px 12px rgba(37, 99, 235, 0.4)' : 'none'
                  }}
                  title="Send query"
                >
                  <ArrowUp size={20} strokeWidth={2.5} />
                </button>
              </div>

            </div>

            {/* Soft Organic Bottom Wave Transition to White/Light Canvas (#F8FAFF) */}
            <svg 
              viewBox="0 0 1440 100" 
              preserveAspectRatio="none" 
              style={{
                position: 'absolute',
                bottom: -1,
                left: 0,
                width: '100%',
                height: '70px',
                pointerEvents: 'none',
                zIndex: 1
              }}
            >
              <path 
                fill="rgba(248, 250, 255, 0.4)" 
                d="M0,25 C360,70 700,5 1060,40 C1240,60 1360,20 1440,30 L1440,100 L0,100 Z" 
              />
              <path 
                fill="#F8FAFF" 
                d="M0,50 C380,95 760,25 1120,65 C1280,80 1380,45 1440,52 L1440,100 L0,100 Z" 
              />
            </svg>

            {/* Subtle Vertical Fade dissolving blue hero into white/light content area */}
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '110px',
              background: 'linear-gradient(to bottom, rgba(248, 250, 255, 0) 0%, rgba(248, 250, 255, 0.3) 40%, rgba(248, 250, 255, 0.8) 80%, #F8FAFF 100%)',
              pointerEvents: 'none',
              zIndex: 1
            }} />

          </div>

          {/* Section: Explore What You Can Ask */}
          <div style={{ 
            padding: '2.5rem 2rem', 
            maxWidth: '1240px', 
            width: '100%', 
            margin: '0 auto',
            flex: 1 
          }}>
            
            {/* Explore Section Header */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'flex-end', 
              marginBottom: '1.5rem', 
              flexWrap: 'wrap', 
              gap: '1rem' 
            }}>
              <div>
                <h2 style={{ 
                  fontSize: '1.45rem', 
                  fontWeight: 800, 
                  fontFamily: 'var(--font-header)', 
                  color: '#0F172A', 
                  margin: 0,
                  letterSpacing: '-0.015em'
                }}>
                  Explore What You Can Ask
                </h2>
                <p style={{ color: '#64748B', fontSize: '0.88rem', marginTop: '0.35rem' }}>
                  Select any question below to load it into the input and customize parameters.
                </p>
              </div>

              {/* Filter Pills */}
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                {['ALL', ...questionCategories.map(c => c.category)].map(cat => {
                  const isSelected = selectedCategory === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      style={{
                        padding: '0.38rem 0.95rem',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        borderRadius: '9999px',
                        border: isSelected ? 'none' : '1px solid #E2E8F0',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        backgroundColor: isSelected ? '#2563EB' : '#FFFFFF',
                        color: isSelected ? '#FFFFFF' : '#475569',
                        boxShadow: isSelected ? '0 2px 8px rgba(37, 99, 235, 0.25)' : 'none'
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.borderColor = '#2563EB';
                          e.currentTarget.style.color = '#2563EB';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.borderColor = '#E2E8F0';
                          e.currentTarget.style.color = '#475569';
                        }
                      }}
                    >
                      {cat === 'ALL' ? 'All Categories' : cat}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category Cards Grid */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: selectedCategory === 'ALL' ? 'repeat(auto-fit, minmax(340px, 1fr))' : '1fr', 
              gap: '1.25rem' 
            }}>
              {questionCategories
                .filter(cat => selectedCategory === 'ALL' || selectedCategory === cat.category)
                .map(cat => {
                  const Icon = cat.icon;
                  return (
                    <div 
                      key={cat.category} 
                      className="glass-panel" 
                      style={{ 
                        padding: '1.35rem', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '0.85rem',
                        backgroundColor: '#FFFFFF',
                        borderRadius: '16px',
                        border: '1px solid #E2E8F0',
                        boxShadow: '0 4px 16px -2px rgba(15, 23, 42, 0.04)'
                      }}
                    >
                      {/* Category Header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', borderBottom: '1px solid #F1F5F9', paddingBottom: '0.75rem' }}>
                        <div style={{ 
                          padding: '0.4rem', 
                          borderRadius: '8px', 
                          backgroundColor: '#F8FAFC',
                          color: cat.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '1px solid #E2E8F0'
                        }}>
                          <Icon size={18} />
                        </div>
                        <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0F172A', letterSpacing: '0.04em' }}>
                          {cat.category}
                        </span>
                      </div>

                      {/* Question Templates in this category */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {cat.questions.map((q, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleApplyTemplate(q)}
                            style={{
                              padding: '0.7rem 0.95rem',
                              borderRadius: '8px',
                              backgroundColor: '#F8FAFC',
                              border: '1px solid #F1F5F9',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '0.75rem',
                              transition: 'all 0.15s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = '#BFDBFE';
                              e.currentTarget.style.backgroundColor = '#EFF6FF';
                              e.currentTarget.style.transform = 'translateY(-1px)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = '#F1F5F9';
                              e.currentTarget.style.backgroundColor = '#F8FAFC';
                              e.currentTarget.style.transform = 'translateY(0)';
                            }}
                            title="Click to populate question and customize parameters"
                          >
                            <span style={{ fontSize: '0.84rem', color: '#0F172A', lineHeight: 1.4 }}>
                              {renderTemplateText(q)}
                            </span>
                            <CornerDownRight size={14} style={{ color: '#94A3B8', flexShrink: 0 }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>

          </div>

        </div>
      ) : (
        // ====================================================
        // CONVERSATIONAL AI CHAT INTERFACE
        // ====================================================
        <div className="chat-container" style={{ flex: 1 }}>
          
          {/* Chat Window Toolbar Header */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            padding: '0.6rem 1.25rem', 
            backgroundColor: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md) var(--radius-md) 0 0'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Sparkles size={14} style={{ color: 'var(--accent-blue)' }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>Active Investigation</span>
              <span className="badge badge-blue" style={{ fontSize: '0.65rem', padding: '0.1rem 0.45rem' }}>
                {messages.filter(m => m.sender === 'user').length} queries
              </span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}>
              {/* History Dropdown Button */}
              <div ref={historyDropdownRef} style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowHistoryDropdown(prev => !prev)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}
                  title="View questions asked in the past 24 hours"
                >
                  <History size={13} style={{ color: 'var(--accent-blue)' }} />
                  <span>History ({recentQueries.length})</span>
                  <ChevronDown size={12} />
                </button>

                {showHistoryDropdown && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '0.4rem',
                    width: '360px',
                    maxWidth: '90vw',
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
                    zIndex: 1000,
                    padding: '0.75rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        <Clock size={13} style={{ color: 'var(--accent-blue)' }} />
                        <span>Recent Questions ({recentQueries.length})</span>
                      </div>
                      <button
                        onClick={handleClearHistory}
                        className="btn btn-secondary"
                        style={{
                          fontSize: '0.7rem',
                          padding: '0.15rem 0.45rem',
                          color: 'var(--accent-red)',
                          borderColor: 'rgba(239, 68, 68, 0.3)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          cursor: 'pointer'
                        }}
                        title="Clear temporary 24-hour question history"
                      >
                        <Trash2 size={11} />
                        <span>Clear History</span>
                      </button>
                    </div>

                    <div style={{ maxHeight: '220px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {recentQueries.length === 0 ? (
                        <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          No questions recorded in the past 24 hours.
                        </div>
                      ) : (
                        recentQueries.map((q, idx) => (
                          <div
                            key={idx}
                            onClick={() => handleSelectHistoryQuestion(q.index, q.text)}
                            style={{
                              padding: '0.5rem 0.65rem',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '0.78rem',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              backgroundColor: 'rgba(255, 255, 255, 0.03)',
                              border: '1px solid transparent',
                              transition: 'all 0.15s ease',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(53, 99, 233, 0.12)';
                              e.currentTarget.style.borderColor = 'rgba(53, 99, 233, 0.3)';
                              e.currentTarget.style.color = '#ffffff';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                              e.currentTarget.style.borderColor = 'transparent';
                              e.currentTarget.style.color = 'var(--text-secondary)';
                            }}
                            title={q.text}
                          >
                            <span style={{ color: 'var(--accent-blue)' }}>•</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {q.text}
                            </span>
                          </div>
                        ))
                      )}
                    </div>

                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '0.4rem', textAlign: 'center' }}>
                      Temporary history retained for 24 hours
                    </div>
                  </div>
                )}
              </div>

              <button 
                onClick={clearChat}
                className="btn btn-secondary" 
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', cursor: 'pointer' }}
              >
                ← New Query / Oracle API Console
              </button>
            </div>
          </div>

          <div 
            ref={chatContainerRef}
            onScroll={(e) => {
              currentScrollTopRef.current = e.currentTarget.scrollTop;
            }}
            className="chat-messages" 
            style={{ padding: '1.5rem' }}
          >
            {messages.map((msg, index) => (
              <div 
                key={index} 
                id={`chat-msg-${index}`}
                ref={index === messages.length - 1 && msg.sender === 'assistant' ? latestAssistantMsgRef : null}
                className={`message-row ${msg.sender}`}
                style={highlightedMsgIndex === index ? {
                  boxShadow: '0 0 0 2px var(--accent-blue)',
                  borderRadius: 'var(--radius-md)',
                  transition: 'all 0.3s ease'
                } : undefined}
              >
                <div className="message-bubble animate-fade-in" style={{ minWidth: msg.loading ? '300px' : 'auto' }}>
                  
                  {msg.sender === 'assistant' && !msg.loading && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-gold)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        <Sparkles size={14} />
                        <span>Oracle Risk Intelligence Assistant</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {/* Open Full Investigation in New Tab */}
                        <button
                          onClick={() => {
                            const investigationId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                            let precedingQuery = '';
                            for (let i = index - 1; i >= 0; i--) {
                              if (messages[i].sender === 'user') {
                                precedingQuery = messages[i].text;
                                break;
                              }
                            }
                            const payload = {
                              id: investigationId,
                              userQuery: precedingQuery || msg.structuredData?.title || 'Security Investigation Query',
                              environmentMode: environmentMode,
                              dataSource: msg.toolResult?.dataSource || msg.structuredData?.metadata?.source || (environmentMode === 'ORACLE_FUSION' ? 'Live Oracle Fusion API' : 'Sample Oracle Fusion Data'),
                              structuredData: msg.structuredData,
                              text: msg.text,
                              intent: msg.intent,
                              parameters: msg.parameters,
                              // Strip redundant huge raw data from toolResult to prevent storage quota exhaustion
                              toolResult: msg.toolResult ? {
                                tool: msg.toolResult.tool,
                                dataSource: msg.toolResult.dataSource,
                                timestamp: msg.toolResult.timestamp,
                                success: msg.toolResult.success
                              } : undefined,
                              createdAt: new Date().toISOString()
                            };

                            // Store in instantaneous global in-memory cache for window.opener
                            globalInvestigationSnapshots.set(investigationId, payload);
                            (window as any).__oracleInvestigationSnapshots = globalInvestigationSnapshots;

                            // Prune old snapshots to avoid browser storage quota exhaustion
                            try {
                              const invKeys: string[] = [];
                              for (let i = 0; i < localStorage.length; i++) {
                                const k = localStorage.key(i);
                                if (k && k.startsWith('oracle_inv_')) invKeys.push(k);
                              }
                              if (invKeys.length >= 2) {
                                invKeys.forEach(k => localStorage.removeItem(k));
                              }
                            } catch (_) {}

                            // Save to local storage and session storage
                            try {
                              localStorage.setItem(`oracle_inv_${investigationId}`, JSON.stringify(payload));
                            } catch (err) {
                              console.warn('localStorage set failed, relying on bridge and backend synchronization:', err);
                            }
                            try {
                              sessionStorage.setItem(`oracle_inv_${investigationId}`, JSON.stringify(payload));
                            } catch (_) {}

                            // Synchronize to authenticated backend store
                            api.saveInvestigation(investigationId, payload).catch(err => {
                              console.warn('Backend snapshot synchronization note:', err);
                            });

                            // Prepare short-lived secure bridge for child tab
                            prepareInvestigationTabBridge(investigationId);

                            if (onOpenFullInvestigation) {
                              onOpenFullInvestigation(investigationId, payload);
                            } else {
                              window.open(`/?investigationId=${investigationId}`, '_blank');
                            }
                          }}
                          style={{
                            background: 'rgba(53, 99, 233, 0.1)',
                            border: '1px solid rgba(53, 99, 233, 0.25)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '0.2rem 0.55rem',
                            color: 'var(--accent-blue)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            transition: 'all 0.2s ease'
                          }}
                          title="Open this answer in a dedicated full-screen tab"
                        >
                          <ExternalLink size={12} />
                          <span>Open Full Investigation ↗</span>
                        </button>

                        {/* Copy Answer */}
                        <button
                          onClick={() => {
                            let textToCopy = msg.text;
                            if (msg.structuredData) {
                              textToCopy = `[${msg.structuredData.title}]\n\n${msg.structuredData.summary}`;
                              if (msg.structuredData.keyFindings?.length > 0) {
                                textToCopy += `\n\nKey Insights:\n` + msg.structuredData.keyFindings.map((f: string) => `- ${f}`).join('\n');
                              }
                              if (msg.structuredData.riskHighlights?.length > 0) {
                                textToCopy += `\n\nRisk Warnings:\n` + msg.structuredData.riskHighlights.map((r: string) => `[WARNING] ${r}`).join('\n');
                              }
                              if (msg.structuredData.table?.rows?.length > 0) {
                                textToCopy += `\n\nData Table:\n` + msg.structuredData.table.rows.map((row: any) => JSON.stringify(row)).join('\n');
                              }
                            }
                            navigator.clipboard.writeText(textToCopy);
                            setCopiedIndex(index);
                            setTimeout(() => setCopiedIndex(null), 2000);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: copiedIndex === index ? 'var(--accent-green)' : 'var(--text-muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            transition: 'color 0.2s ease'
                          }}
                          onMouseEnter={(e) => { if (copiedIndex !== index) e.currentTarget.style.color = 'var(--text-primary)'; }}
                          onMouseLeave={(e) => { if (copiedIndex !== index) e.currentTarget.style.color = 'var(--text-muted)'; }}
                        >
                          {copiedIndex === index ? (
                            <>
                              <Check size={12} />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy size={12} />
                              <span>Copy Answer</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {msg.loading ? (
                    <ChatLoader />
                  ) : msg.sender === 'user' ? (
                    editingIndex === index ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                        <textarea
                          className="form-input"
                          style={{ 
                            width: '100%', 
                            minHeight: '60px', 
                            resize: 'vertical', 
                            fontSize: '0.9rem', 
                            backgroundColor: 'rgba(255,255,255,0.05)', 
                            color: '#ffffff',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '0.5rem'
                          }}
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', alignSelf: 'flex-end' }}>
                          <button
                            onClick={() => setEditingIndex(null)}
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleEditAndResubmit(index, editingText)}
                            className="btn btn-primary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}
                          >
                            Save & Submit
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '1rem' }}>
                        <p style={{ margin: 0, fontSize: '0.92rem', fontWeight: 500, color: '#ffffff', whiteSpace: 'pre-line' }}>
                          {msg.text}
                        </p>
                        <button
                          onClick={() => {
                            setEditingIndex(index);
                            setEditingText(msg.text);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ffffff',
                            opacity: 0.85,
                            cursor: 'pointer',
                            padding: '0.2rem',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'opacity 0.2s ease',
                            flexShrink: 0
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                          onMouseLeave={(e) => e.currentTarget.style.opacity = '0.85'}
                          title="Edit question"
                        >
                          <Edit2 size={13} style={{ color: '#ffffff' }} />
                        </button>
                      </div>
                    )
                  ) : msg.structuredData ? (
                    renderStructuredData(msg.structuredData, msg, index)
                  ) : msg.toolResult && msg.toolResult.success === false ? (
                    renderErrorCard(msg.toolResult)
                  ) : (
                    <>
                      <p style={{ whiteSpace: 'pre-line', fontSize: '0.9rem' }}>
                        {msg.text}
                      </p>
                      {/* Rich Structured Data Tables / Visuals */}
                      {msg.toolResult && renderRichData(msg.toolResult, msg.intent || '')}
                    </>
                  )}

                  {/* Data Source Indicators */}
                  {msg.sender === 'assistant' && msg.toolResult && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginTop: '0.75rem',
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                      borderTop: '1px solid var(--border-color)',
                      paddingTop: '0.5rem'
                    }}>
                      <Database size={12} style={{ color: msg.toolResult.success ? 'var(--accent-green)' : 'var(--accent-red)' }} />
                      <span>Data Source: <strong>{msg.toolResult.dataSource}</strong></span>
                      <span style={{ color: 'var(--text-muted)' }}>|</span>
                      <span>Retrieved: {new Date(msg.toolResult.timestamp).toLocaleTimeString()}</span>
                    </div>
                  )}

                  {/* Developer execution trace */}
                  {msg.sender === 'assistant' && msg.toolResult && (
                    <details 
                      open={expandedDetails[index] || false}
                      onToggle={(e) => {
                        const isOpen = (e.target as HTMLDetailsElement).open;
                        setExpandedDetails(prev => ({ ...prev, [index]: isOpen }));
                      }}
                      style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}
                    >
                      <summary style={{ cursor: 'pointer', outline: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Terminal size={12} />
                        <span>View API Execution Details</span>
                      </summary>
                      <div className="glass-panel" style={{
                        marginTop: '0.5rem',
                        padding: '0.75rem',
                        backgroundColor: 'rgba(0, 0, 0, 0.2)',
                        fontFamily: 'monospace',
                        borderRadius: 'var(--radius-sm)',
                        lineHeight: '1.4',
                        overflowX: 'auto'
                      }}>
                        <div>{`// Intent detected by NLU:`}</div>
                        <div style={{ color: '#f59e0b', marginBottom: '0.25rem' }}>{`intent: "${msg.intent || 'UNKNOWN'}"`}</div>
                        <div>{`// Controlled operation executed:`}</div>
                        <div style={{ color: '#a7f3d0', marginBottom: '0.25rem' }}>{`tool: "${msg.toolResult.tool}"`}</div>
                        <div>{`// Query Parameters passed:`}</div>
                        <div style={{ color: '#60a5fa', marginBottom: '0.25rem' }}>{`params: ${JSON.stringify(msg.toolResult.parameters)}`}</div>
                        <div>{`// Server Status Code:`}</div>
                        <div style={{ color: msg.toolResult.success ? '#34d399' : '#f87171' }}>
                          {msg.toolResult.success ? 'HTTP 200 OK (Success)' : `Execution Failure: "${msg.toolResult.error}"`}
                        </div>
                      </div>
                    </details>
                  )}

                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* AI Follow-up suggestions */}
          <div style={{ padding: '0.5rem 1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {suggestedTemplates.map((tpl, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleApplyTemplate(tpl)}
                className="btn btn-secondary animate-fade-in"
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.75rem',
                  borderColor: 'var(--border-color)',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer'
                }}
                title="Click to populate query template into chat input"
              >
                <span>{renderTemplateText(tpl)}</span>
              </button>
            ))}
          </div>

          {/* Chat message input bar */}
          <div className="chat-input-bar" style={{ margin: '1rem 1.5rem 1.5rem 1.5rem' }}>
            <textarea
              ref={chatInputRef}
              className="chat-input-textarea"
              placeholder="Ask a question (e.g. 'Who has the <role name> role?' or 'Which roles are assigned to <username>?')..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              rows={1}
            />
            <button
              style={{
                padding: '0.4rem',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                backgroundColor: inputValue.trim() && !sending ? 'var(--accent-blue)' : '#e2e8f0',
                color: inputValue.trim() && !sending ? '#ffffff' : '#94a3b8',
                border: 'none',
                cursor: inputValue.trim() && !sending ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s ease',
                boxShadow: inputValue.trim() && !sending ? '0 2px 6px rgba(53, 99, 233, 0.2)' : 'none'
              }}
              onClick={() => handleSend(inputValue)}
              disabled={sending || !inputValue.trim()}
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          </div>

        </div>
      )}
      
    </div>
  );
}
