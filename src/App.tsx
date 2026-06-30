import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  ShieldAlert,
  Users,
  ArrowRightLeft,
  RefreshCw,
  Sliders,
  Search,
  FileText,
  CheckCircle,
  AlertTriangle,
  CircleAlert,
  Maximize2,
  Eye,
  Settings,
  Info,
  Layers,
  ArrowRight,
  Sparkles,
  HelpCircle,
  Database,
  Play,
  RotateCcw
} from 'lucide-react';

// Domain imports
import { Account, Transaction, Finding, GeneratorConfig, DetectionConfig, GroundTruthPattern, PatternType } from './domain/types';
import { generateDataset, DEFAULT_CONFIG } from './generator';
import { runDetection, DEFAULT_DETECTION_CONFIG } from './detectors';
import { evaluateDetection, ValidationReport } from './scoring/validator';
import { computeForceDirectedLayout, LayoutMap, Point } from './domain/layout';
import { getOutgoingTransactions, getIncomingTransactions } from './domain/helpers';

export default function App() {
  // --- 1. CONFIG STATES ---
  const [genConfig, setGenConfig] = useState<GeneratorConfig>({ ...DEFAULT_CONFIG });
  const [detConfig, setDetConfig] = useState<DetectionConfig>({ ...DEFAULT_DETECTION_CONFIG });

  // --- 2. DATASET STATES ---
  const [dataset, setDataset] = useState(() => generateDataset(DEFAULT_CONFIG));
  const [findings, setFindings] = useState<Finding[]>([]);
  const [evaluation, setEvaluation] = useState<ValidationReport | null>(null);
  const [layout, setLayout] = useState<LayoutMap>(new Map());

  // --- 3. UI STATES ---
  const [activeTab, setActiveTab] = useState<'graph' | 'subgraph'>('graph');
  const [controlTab, setControlTab] = useState<'generator' | 'detector'>('generator');
  const [listingTab, setListingTab] = useState<'detected' | 'planted'>('detected');
  
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [selectedPlanted, setSelectedPlanted] = useState<{ pattern: GroundTruthPattern; type: PatternType } | null>(null);
  
  const [searchTerm, setSearchTerm] = useState('');
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // --- 4. CANVAS ZOOM/PAN STATES ---
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Tooltip tracking
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<Transaction | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // --- 5. EFFECTS ---
  // Run detection and update evaluation/layout on dataset changes or config tweaks
  useEffect(() => {
    const results = runDetection(dataset.graph, detConfig);
    setFindings(results);

    const report = evaluateDetection(results, dataset.groundTruth);
    setEvaluation(report);

    // Compute layout
    const accountsArray = Array.from(dataset.graph.accounts.values()) as Account[];
    const layoutMap = computeForceDirectedLayout(accountsArray, dataset.graph.transactions, 800, 500);
    setLayout(layoutMap);

    // Reset selection defaults
    setSelectedAccountId(null);
    setSelectedFinding(null);
    setSelectedPlanted(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [dataset, detConfig]);

  // Handle graph regeneration
  const handleRegenerate = (customConfig?: GeneratorConfig) => {
    setIsRegenerating(true);
    // Timeout to allow spinner animation
    setTimeout(() => {
      const newDataset = generateDataset(customConfig || genConfig);
      setDataset(newDataset);
      setIsRegenerating(false);
    }, 300);
  };

  // Preset quick triggers
  const applyPreset = (type: 'default' | 'low_noise' | 'heavy_fraud') => {
    let presetGen: GeneratorConfig = { ...DEFAULT_CONFIG };
    let presetDet: DetectionConfig = { ...DEFAULT_DETECTION_CONFIG };

    if (type === 'low_noise') {
      presetGen = {
        ...DEFAULT_CONFIG,
        numAccounts: 120,
        numNormalTransactions: 800,
        numNearMisses: 2,
        numSmurfingInstances: 2,
        numRapidPassThroughInstances: 2,
        numCircularFlowInstances: 2,
        seed: 'clean-slate-2026'
      };
    } else if (type === 'heavy_fraud') {
      presetGen = {
        ...DEFAULT_CONFIG,
        numAccounts: 250,
        numNormalTransactions: 2800,
        numNearMisses: 18,
        numSmurfingInstances: 5,
        numRapidPassThroughInstances: 5,
        numCircularFlowInstances: 4,
        seed: 'chaos-network-2026'
      };
    }

    setGenConfig(presetGen);
    setDetConfig(presetDet);
    handleRegenerate(presetGen);
  };

  // Restore Default settings (Generator + Detector)
  const handleRestoreDefaults = () => {
    setGenConfig({ ...DEFAULT_CONFIG });
    setDetConfig({ ...DEFAULT_DETECTION_CONFIG });
    const newDataset = generateDataset(DEFAULT_CONFIG);
    setDataset(newDataset);
  };

  // Create lookup structures for quick color indicators
  const flaggedDetails = useMemo(() => {
    const accountRoles = new Map<string, { type: PatternType; fid: string }[]>();
    const transactionRoles = new Map<string, { type: PatternType; fid: string }>();

    findings.forEach(f => {
      f.accountIds.forEach(accId => {
        const roles = accountRoles.get(accId) || [];
        roles.push({ type: f.patternType, fid: f.id });
        accountRoles.set(accId, roles);
      });
      f.transactionIds.forEach(txId => {
        transactionRoles.set(txId, { type: f.patternType, fid: f.id });
      });
    });

    return { accountRoles, transactionRoles };
  }, [findings]);

  // Filter accounts for list or query
  const filteredAccounts = useMemo(() => {
    const accs = Array.from(dataset.graph.accounts.values()) as Account[];
    if (!searchTerm) return accs.slice(0, 50); // cap size for ledger rendering
    const s = searchTerm.toUpperCase();
    return accs.filter(a => a.id.toUpperCase().includes(s)).slice(0, 50);
  }, [dataset, searchTerm]);

  // Ground truth evaluation lists
  const plantedPatternsCombined = useMemo(() => {
    const list: { pattern: GroundTruthPattern; type: PatternType; detected: boolean }[] = [];

    const checkDetected = (pt: GroundTruthPattern, type: PatternType) => {
      // Planted is detected if any finding of matching type shares transaction IDs
      const ptTxs = new Set(pt.transactionIds);
      return findings.some(f => f.patternType === type && f.transactionIds.some(txId => ptTxs.has(txId)));
    };

    dataset.groundTruth.smurfing.forEach(p => {
      list.push({ pattern: p, type: 'smurfing', detected: checkDetected(p, 'smurfing') });
    });
    dataset.groundTruth.rapidPassThrough.forEach(p => {
      list.push({ pattern: p, type: 'rapid_pass_through', detected: checkDetected(p, 'rapid_pass_through') });
    });
    dataset.groundTruth.circularFlow.forEach(p => {
      list.push({ pattern: p, type: 'circular_flow', detected: checkDetected(p, 'circular_flow') });
    });

    return list;
  }, [dataset, findings]);

  // Color theme helpers
  const getPatternStyles = (type: PatternType) => {
    switch (type) {
      case 'smurfing':
        return {
          primary: 'text-amber-600 bg-amber-50 border-amber-200',
          badge: 'bg-amber-100 text-amber-800 border-amber-300',
          fill: '#f59e0b',
          stroke: '#d97706',
          label: 'Structuring (Smurfing)'
        };
      case 'rapid_pass_through':
        return {
          primary: 'text-rose-600 bg-rose-50 border-rose-200',
          badge: 'bg-rose-100 text-rose-800 border-rose-300',
          fill: '#f43f5e',
          stroke: '#e11d48',
          label: 'Rapid Pass-Through'
        };
      case 'circular_flow':
        return {
          primary: 'text-indigo-600 bg-indigo-50 border-indigo-200',
          badge: 'bg-indigo-100 text-indigo-800 border-indigo-300',
          fill: '#6366f1',
          stroke: '#4f46e5',
          label: 'Circular Flow'
        };
    }
  };

  // --- 6. CANVAS RENDERING ENGINE (HTML5) ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI display density
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);

    const w = rect.width;
    const h = rect.height;

    // Clear Canvas with grid background
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    // Draw coordinate grids (faint dots)
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    const gridSize = 40;
    const offset = {
      x: pan.x % gridSize,
      y: pan.y % gridSize
    };
    
    ctx.fillStyle = '#cbd5e1';
    for (let x = offset.x; x < w; x += gridSize) {
      for (let y = offset.y; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.arc(x, y, 1.2, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    ctx.save();
    // Apply pan & zoom transformations
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Gather active filters
    const filterNodes = showFlaggedOnly;
    const flaggedAccountIds = new Set<string>();
    findings.forEach(f => f.accountIds.forEach(id => flaggedAccountIds.add(id)));
    const flaggedTxIds = new Set<string>();
    findings.forEach(f => f.transactionIds.forEach(id => flaggedTxIds.add(id)));

    // 1. Draw Edges (Transactions)
    dataset.graph.transactions.forEach(tx => {
      const fromPos = layout.get(tx.fromAccountId);
      const toPos = layout.get(tx.toAccountId);
      if (!fromPos || !toPos) return;

      const isFlagged = flaggedDetails.transactionRoles.has(tx.id);
      if (filterNodes && !isFlagged) return; // skip normal edges in flagged-only mode

      // Determine colors and line weight
      let strokeColor = 'rgba(203, 213, 225, 0.3)'; // very faint gray
      let lineWidth = 1;

      if (isFlagged) {
        const role = flaggedDetails.transactionRoles.get(tx.id)!;
        const styles = getPatternStyles(role.type);
        strokeColor = styles.stroke;
        lineWidth = 2.5;
      } else if (selectedAccountId && (tx.fromAccountId === selectedAccountId || tx.toAccountId === selectedAccountId)) {
        strokeColor = 'rgba(100, 116, 139, 0.7)'; // highlighted neighbor
        lineWidth = 1.5;
      }

      // Draw curve or straight line
      ctx.beginPath();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;

      // Draw curved edge if there's self-loop (not present) or dual links, otherwise straight
      ctx.moveTo(fromPos.x, fromPos.y);
      ctx.lineTo(toPos.x, toPos.y);
      ctx.stroke();

      // Draw directional arrow midway
      const midX = (fromPos.x + toPos.x) / 2;
      const midY = (fromPos.y + toPos.y) / 2;
      const angle = Math.atan2(toPos.y - fromPos.y, toPos.x - fromPos.x);
      
      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(angle);
      ctx.fillStyle = strokeColor;
      ctx.beginPath();
      ctx.moveTo(-5, -4);
      ctx.lineTo(5, 0);
      ctx.lineTo(-5, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });

    // 2. Draw Nodes (Accounts)
    dataset.graph.accounts.forEach(acc => {
      const pos = layout.get(acc.id);
      if (!pos) return;

      const isFlagged = flaggedDetails.accountRoles.has(acc.id);
      if (filterNodes && !isFlagged) return; // skip normal nodes in flagged-only mode

      // Node styling variables
      let radius = 7;
      let fillStyle = '#ffffff';
      let strokeStyle = '#475569';
      let nodeLineWidth = 1.5;

      // Check high degree nodes (super agents)
      const outgoingCount = dataset.graph.outgoing.get(acc.id)?.length || 0;
      const incomingCount = dataset.graph.incoming.get(acc.id)?.length || 0;
      const totalDegree = outgoingCount + incomingCount;

      if (totalDegree > 18) {
        radius = 9.5;
        fillStyle = '#f1f5f9';
        strokeStyle = '#1e293b';
        nodeLineWidth = 2;
      }

      // Check if flagged
      if (isFlagged) {
        const roles = flaggedDetails.accountRoles.get(acc.id)!;
        const styles = getPatternStyles(roles[0].type); // use first active role
        radius = 11;
        fillStyle = styles.fill;
        strokeStyle = styles.stroke;
        nodeLineWidth = 2.5;
      }

      // Selected Account highlight
      const isSelected = selectedAccountId === acc.id;
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 5, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.fill();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Hovered Node highlight
      const isHovered = hoveredNodeId === acc.id;
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 3, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.15)';
        ctx.fill();
      }

      // Draw node circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = fillStyle;
      ctx.fill();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = nodeLineWidth;
      ctx.stroke();

      // Node Label (for flagged, super agents, selected, or hovered nodes)
      if (isFlagged || totalDegree > 18 || isSelected || isHovered) {
        ctx.fillStyle = isFlagged ? '#0f172a' : '#475569';
        ctx.font = isFlagged ? 'bold 9px monospace' : '9px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(acc.id, pos.x, pos.y + radius + 3);
      }
    });

    ctx.restore();
  }, [dataset, layout, zoom, pan, selectedAccountId, hoveredNodeId, showFlaggedOnly, findings, flaggedDetails]);

  // --- 7. INTERACTIVE CANVAS HANDLERS ---
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    setMousePos({ x: e.clientX, y: e.clientY });

    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y
      });
      return;
    }

    // Node Hover detection
    // Map canvas relative mouse coordinates back through zoom & pan
    const graphX = (canvasX - pan.x) / zoom;
    const graphY = (canvasY - pan.y) / zoom;

    let foundNodeId: string | null = null;
    for (const [accId, pos] of layout.entries()) {
      // If we show flagged only, skip normal nodes
      const isFlagged = flaggedDetails.accountRoles.has(accId);
      if (showFlaggedOnly && !isFlagged) continue;

      const dx = graphX - pos.x;
      const dy = graphY - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= 14) {
        foundNodeId = accId;
        break;
      }
    }
    setHoveredNodeId(foundNodeId);
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(false);

    // If mouse didn't drag far, treat as a node click selection
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    const graphX = (canvasX - pan.x) / zoom;
    const graphY = (canvasY - pan.y) / zoom;

    let clickedNodeId: string | null = null;
    for (const [accId, pos] of layout.entries()) {
      const isFlagged = flaggedDetails.accountRoles.has(accId);
      if (showFlaggedOnly && !isFlagged) continue;

      const dx = graphX - pos.x;
      const dy = graphY - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= 14) {
        clickedNodeId = accId;
        break;
      }
    }

    if (clickedNodeId) {
      setSelectedAccountId(clickedNodeId);
      setSelectedFinding(null);
      setSelectedPlanted(null);
      
      // Look up if this node belongs to any findings, highlight first if so
      const activeRoles = flaggedDetails.accountRoles.get(clickedNodeId);
      if (activeRoles && activeRoles.length > 0) {
        const findMatch = findings.find(f => f.id === activeRoles[0].fid);
        if (findMatch) setSelectedFinding(findMatch);
      }
    } else {
      // Clear selection if clicked background
      setSelectedAccountId(null);
    }
  };

  // Zoom controls
  const handleZoomIn = () => setZoom(z => Math.min(4, z * 1.2));
  const handleZoomOut = () => setZoom(z => Math.max(0.3, z / 1.2));
  const handleZoomReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // --- 8. PATTERN SUB-GRAPH GENERATION COMPONENT ---
  const renderSubgraphVisualiser = () => {
    // Determine which pattern to render: selected finding or selected planted pattern
    let patternType: PatternType = 'smurfing';
    let accountIds: string[] = [];
    let transactionIds: string[] = [];
    let headingText = 'No Pattern Selected';
    let explanation = '';

    if (selectedFinding) {
      patternType = selectedFinding.patternType;
      accountIds = selectedFinding.accountIds;
      transactionIds = selectedFinding.transactionIds;
      headingText = `Flagged Case: ${selectedFinding.id}`;
      explanation = selectedFinding.explanation;
    } else if (selectedPlanted) {
      patternType = selectedPlanted.type;
      accountIds = selectedPlanted.pattern.accountIds;
      transactionIds = selectedPlanted.pattern.transactionIds;
      headingText = `Planted Case: ${selectedPlanted.pattern.patternId}`;
      explanation = `Planted ground truth event of type ${patternType.replace(/_/g, ' ')}. It consists of ${accountIds.length} accounts and ${transactionIds.length} transactions.`;
    } else {
      return (
        <div className="flex flex-col items-center justify-center h-96 border border-slate-200 bg-slate-50 rounded-xl text-slate-400 p-6">
          <Maximize2 className="h-10 w-10 mb-2 stroke-[1.5]" />
          <p className="text-sm font-medium">Select a Finding or Ground Truth pattern below</p>
          <p className="text-xs text-slate-400 mt-1">We will render a clean, high-fidelity diagram of the money flow legs</p>
        </div>
      );
    }

    // Filter transactions involved
    const matchedTxs = dataset.graph.transactions.filter(tx => transactionIds.includes(tx.id));
    const theme = getPatternStyles(patternType);

    // Dynamic schematic construction depending on pattern type
    return (
      <div className="border border-slate-200 bg-white rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${theme.badge}`}>
                {theme.label}
              </span>
              <span className="text-xs text-slate-400 font-mono">
                {matchedTxs.length} transfer(s)
              </span>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mt-1 font-mono">{headingText}</h3>
          </div>
          <button
            onClick={() => {
              // Reset focus to general graph
              setActiveTab('graph');
              if (accountIds.length > 0) setSelectedAccountId(accountIds[0]);
            }}
            className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium bg-blue-50 px-2 py-1 rounded"
          >
            <Layers className="h-3 w-3" /> View on Main Graph
          </button>
        </div>

        <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100 mb-6 font-sans leading-relaxed">
          <strong>Leg explanation:</strong> {explanation}
        </p>

        {/* Dynamic Diagram Stage */}
        <div className="relative w-full overflow-x-auto py-8 px-2 bg-slate-50/50 rounded-lg border border-slate-100 flex justify-center min-h-[300px] items-center">
          
          {/* A. SMURFING SUB-GRAPH SCHEMATIC */}
          {patternType === 'smurfing' && (
            <div className="flex flex-col md:flex-row items-center gap-12 max-w-full">
              {/* Origin Account (Left) */}
              <div className="flex flex-col items-center">
                <div className="h-16 w-16 rounded-full bg-amber-500 text-white font-mono font-bold text-xs flex items-center justify-center border-4 border-amber-200 shadow-md">
                  {accountIds[0]}
                </div>
                <span className="text-xs font-bold text-slate-700 mt-2">Structuring Origin</span>
                <span className="text-[10px] text-slate-400 font-mono">Outbound: {matchedTxs.length} legs</span>
              </div>

              {/* Connected arrow system with listed totals */}
              <div className="flex flex-col gap-6 max-h-[250px] overflow-y-auto pr-3 border-l-2 border-dashed border-amber-300 pl-6 py-2">
                {accountIds.slice(1).map((colId, cIdx) => {
                  const legTxs = matchedTxs.filter(tx => tx.toAccountId === colId);
                  const totalLegAmt = legTxs.reduce((sum, t) => sum + t.amount, 0);
                  
                  return (
                    <div key={colId} className="flex items-center gap-4">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-800 font-mono">{totalLegAmt.toLocaleString()} LCU</span>
                          <span className="text-[10px] text-slate-500 font-mono">({legTxs.length} txs)</span>
                        </div>
                        <span className="text-[9px] text-amber-600 font-medium">Split struct. transfer →</span>
                      </div>
                      
                      <div className="flex flex-col items-center">
                        <div className="h-12 w-12 rounded-full bg-slate-100 text-slate-700 font-mono font-medium text-[10px] flex items-center justify-center border border-slate-300 shadow-sm">
                          {colId}
                        </div>
                        <span className="text-[9px] text-slate-500 font-bold mt-1">Collector #{cIdx + 1}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* B. MULE CHAIN / RAPID PASS-THROUGH SCHEMATIC */}
          {patternType === 'rapid_pass_through' && (
            <div className="flex flex-col sm:flex-row items-center gap-4 min-w-[500px] justify-between w-full px-8">
              {accountIds.map((accId, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === accountIds.length - 1;
                const txToNext = matchedTxs[idx]; // sequential transactions

                return (
                  <div key={accId} className="flex items-center flex-1 last:flex-none">
                    {/* Node */}
                    <div className="flex flex-col items-center z-10">
                      <div className={`h-14 w-14 rounded-full font-mono text-xs flex items-center justify-center border-4 shadow-md font-bold
                        ${isFirst ? 'bg-emerald-500 text-white border-emerald-100' : 
                          isLast ? 'bg-blue-600 text-white border-blue-100' : 
                          'bg-rose-500 text-white border-rose-100'}`}
                      >
                        {accId}
                      </div>
                      <span className="text-[10px] font-bold text-slate-700 mt-2">
                        {isFirst ? 'Funds Source' : isLast ? 'Terminal Recipient' : `Mule Leg #${idx}`}
                      </span>
                    </div>

                    {/* Edge line to next node */}
                    {!isLast && txToNext && (
                      <div className="flex-1 flex flex-col items-center px-2 relative min-w-[70px]">
                        <div className="h-0.5 bg-rose-400 w-full relative">
                          <ArrowRight className="h-4 w-4 text-rose-500 absolute -top-[7px] right-0 translate-x-1/2" />
                        </div>
                        <span className="text-[10px] font-mono font-bold text-slate-900 bg-white px-1.5 py-0.5 rounded border border-slate-100 shadow-sm mt-1 z-10">
                          {txToNext.amount.toLocaleString()}
                        </span>
                        <span className="text-[8px] text-slate-400 font-mono mt-0.5">
                          T: +{idx > 0 ? Math.round((txToNext.timestamp - matchedTxs[idx-1].timestamp) / 60) : 0}m
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* C. CIRCULAR FLOW COMPONENT */}
          {patternType === 'circular_flow' && (
            <div className="relative w-80 h-80 flex items-center justify-center">
              {/* Central text displaying retained % */}
              <div className="absolute text-center bg-white p-3 rounded-full border border-slate-100 shadow-md w-28 h-28 flex flex-col items-center justify-center z-10">
                <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-500">Loop Integrity</span>
                <span className="text-lg font-extrabold text-slate-800 font-mono">
                  {matchedTxs.length > 0 ? 
                    ((matchedTxs[matchedTxs.length - 1].amount / matchedTxs[0].amount) * 100).toFixed(0) : '0'}%
                </span>
                <span className="text-[8px] text-slate-400">retained total</span>
              </div>

              {/* Distribute nodes symmetrically in a circle */}
              {accountIds.map((accId, idx) => {
                const angle = (idx / accountIds.length) * 2 * Math.PI - Math.PI / 2;
                const radius = 100; // px
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;

                return (
                  <div
                    key={accId}
                    className="absolute flex flex-col items-center"
                    style={{ transform: `translate(${x}px, ${y}px)` }}
                  >
                    <div className="h-12 w-12 rounded-full bg-indigo-500 text-white font-mono text-xs flex items-center justify-center border-4 border-indigo-200 shadow-md font-bold">
                      {accId}
                    </div>
                  </div>
                );
              })}

              {/* Loop transactions */}
              <div className="absolute inset-0 border-2 border-dashed border-indigo-300 rounded-full scale-[0.8] opacity-40 pointer-events-none" />
              
              {/* Show tabular list of loop flow hops for numeric clarity */}
              <div className="absolute -bottom-8 bg-white px-2 py-1 rounded border border-indigo-100 shadow-sm text-[9px] font-mono font-medium text-slate-600 flex gap-2">
                {matchedTxs.map((tx, idx) => (
                  <span key={tx.id} className="border-r border-slate-100 pr-2 last:border-0">
                    Hop {idx+1}: {tx.amount.toLocaleString()}
                  </span>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    );
  };

  // --- 9. STATISTICS & EVALUATION CALCULATOR ---
  const activeAlertCount = findings.length;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col antialiased">
      {/* HEADER BAR */}
      <header className="sticky top-0 bg-white border-b border-slate-200 z-30 px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 shadow-sm">
                <ShieldAlert className="h-5 w-5" />
              </span>
              <h1 className="text-lg font-bold tracking-tight text-slate-900">
                Mobile Money Fraud Pattern Visualiser
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1 font-sans">
              Algorithmic graph audit simulator. Handwritten pattern filters running against seed-synthesized ledger data.
            </p>
          </div>

          {/* Quick presets controller */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">Scenario Presets:</span>
            <button
              onClick={() => applyPreset('low_noise')}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded font-semibold text-slate-700 transition"
            >
              Low Noise (Easy)
            </button>
            <button
              onClick={() => applyPreset('default')}
              className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded font-semibold border border-blue-100 transition"
            >
              Default Sandbox
            </button>
            <button
              onClick={() => applyPreset('heavy_fraud')}
              className="px-3 py-1.5 bg-amber-50 text-amber-800 hover:bg-amber-100 rounded font-semibold border border-amber-100 transition"
            >
              Heavy Traffic (Chaos)
            </button>
            <button
              onClick={handleRestoreDefaults}
              title="Reset configuration sliders to default parameters"
              className="p-1.5 bg-slate-50 hover:bg-slate-100 rounded text-slate-400 border border-slate-200 transition"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">

        {/* METRIC SCOREBAR GRID */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
          
          <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-slate-50 text-slate-600">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">Network Size</span>
              <span className="text-lg font-extrabold font-mono text-slate-800">{dataset.graph.accounts.size}</span>
              <span className="text-[10px] text-slate-400 block">accounts (nodes)</span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-slate-50 text-slate-600">
              <ArrowRightLeft className="h-5 w-5" />
            </div>
            <div>
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Ledger</span>
              <span className="text-lg font-extrabold font-mono text-slate-800">{dataset.graph.transactions.length}</span>
              <span className="text-[10px] text-slate-400 block">transfers (edges)</span>
            </div>
          </div>

          <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex items-center gap-3 col-span-2 md:col-span-1">
            <div className={`p-2.5 rounded-lg ${activeAlertCount > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">Flagged Alerts</span>
              <span className="text-lg font-extrabold font-mono text-slate-800">{activeAlertCount}</span>
              <span className="text-[10px] text-slate-400 block">fraud alerts raised</span>
            </div>
          </div>

          {/* EVALUATION SCORES (Live Precision & Recall) */}
          <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Precision (FPs Audit)</span>
              <span className="text-xs font-mono font-bold text-emerald-600 bg-emerald-50 px-1.5 rounded">
                TPs: {evaluation?.overall.truePositives || 0}
              </span>
            </div>
            <div className="flex items-end justify-between mt-2">
              <span className="text-2xl font-black font-mono text-slate-800">
                {evaluation ? (evaluation.overall.precision * 100).toFixed(0) : '0'}%
              </span>
              <span className="text-[10px] text-slate-400 text-right font-sans leading-none pb-1">
                {evaluation?.overall.falsePositives || 0} False Positive findings
              </span>
            </div>
            <div className="w-full bg-slate-100 h-1 rounded overflow-hidden mt-1">
              <div 
                className="bg-emerald-500 h-1 rounded transition-all duration-300"
                style={{ width: `${(evaluation?.overall.precision || 0) * 100}%` }}
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Recall (Model Coverage)</span>
              <span className="text-xs font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 rounded">
                Planted: {evaluation?.overall.totalPlanted || 0}
              </span>
            </div>
            <div className="flex items-end justify-between mt-2">
              <span className="text-2xl font-black font-mono text-slate-800">
                {evaluation ? (evaluation.overall.recall * 100).toFixed(0) : '0'}%
              </span>
              <span className="text-[10px] text-slate-400 text-right font-sans leading-none pb-1">
                Found {evaluation?.overall.truePositives || 0} of {evaluation?.overall.totalPlanted || 0}
              </span>
            </div>
            <div className="w-full bg-slate-100 h-1 rounded overflow-hidden mt-1">
              <div 
                className="bg-indigo-500 h-1 rounded transition-all duration-300"
                style={{ width: `${(evaluation?.overall.recall || 0) * 100}%` }}
              />
            </div>
          </div>

        </section>

        {/* WORKSPACE DIVIDER GRID */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT PANEL: SIMULATION CONTROL CENTER */}
          <div className="lg:col-span-4 space-y-6">
            
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="flex border-b border-slate-100 bg-slate-50/50 p-1">
                <button
                  onClick={() => setControlTab('generator')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all
                    ${controlTab === 'generator' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  <Database className="h-3.5 w-3.5" />
                  1. Synthetic Gen
                </button>
                <button
                  onClick={() => setControlTab('detector')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-lg transition-all
                    ${controlTab === 'detector' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  <Sliders className="h-3.5 w-3.5" />
                  2. Detector Audit
                </button>
              </div>

              <div className="p-5">
                {/* A. SYNTHETIC GENERATOR SETTINGS */}
                {controlTab === 'generator' && (
                  <div className="space-y-4">
                    <div className="border-b border-slate-100 pb-2 mb-2 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Baseline Network</span>
                      <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-mono">Seed: {genConfig.seed || 'Unseeded'}</span>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                          <span>Account Nodes count</span>
                          <span className="font-mono font-bold text-slate-900">{genConfig.numAccounts}</span>
                        </div>
                        <input
                          type="range"
                          min="30"
                          max="400"
                          step="10"
                          value={genConfig.numAccounts}
                          onChange={e => setGenConfig(prev => ({ ...prev, numAccounts: parseInt(e.target.value) }))}
                          className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                          <span>Normal Transfers (Edges)</span>
                          <span className="font-mono font-bold text-slate-900">{genConfig.numNormalTransactions}</span>
                        </div>
                        <input
                          type="range"
                          min="200"
                          max="3500"
                          step="100"
                          value={genConfig.numNormalTransactions}
                          onChange={e => setGenConfig(prev => ({ ...prev, numNormalTransactions: parseInt(e.target.value) }))}
                          className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg cursor-pointer"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                          <span>Timeline Span (Days)</span>
                          <span className="font-mono font-bold text-slate-900">{genConfig.timeWindowDays} days</span>
                        </div>
                        <input
                          type="range"
                          min="3"
                          max="60"
                          value={genConfig.timeWindowDays}
                          onChange={e => setGenConfig(prev => ({ ...prev, timeWindowDays: parseInt(e.target.value) }))}
                          className="w-full accent-blue-600 h-1 bg-slate-100 rounded-lg cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="text-xs font-semibold text-slate-700">Seeded Repro Key:</label>
                        <input
                          type="text"
                          value={genConfig.seed || ''}
                          placeholder="Random"
                          onChange={e => setGenConfig(prev => ({ ...prev, seed: e.target.value || undefined }))}
                          className="flex-1 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs font-mono"
                        />
                        <button
                          onClick={() => setGenConfig(prev => ({ ...prev, seed: Math.random().toString(36).substring(2, 9) }))}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-xs text-slate-600 font-semibold"
                        >
                          New
                        </button>
                      </div>
                    </div>

                    <div className="border-b border-slate-100 pb-2 pt-2 mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">Inject Fraud Legacies</span>
                    </div>

                    <div className="space-y-3.5">
                      <div className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/50">
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={genConfig.injectSmurfing}
                              onChange={e => setGenConfig(prev => ({ ...prev, injectSmurfing: e.target.checked }))}
                              className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                            />
                            Structuring (Smurfing)
                          </label>
                          <span className="text-[10px] font-bold text-amber-700 font-mono bg-amber-100 px-1.5 rounded">Pattern A</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-[10px] text-slate-400">Count to plant</span>
                          <input
                            type="range"
                            min="1"
                            max="7"
                            disabled={!genConfig.injectSmurfing}
                            value={genConfig.numSmurfingInstances}
                            onChange={e => setGenConfig(prev => ({ ...prev, numSmurfingInstances: parseInt(e.target.value) }))}
                            className="flex-1 accent-amber-500 h-1 bg-slate-200 rounded"
                          />
                          <span className="text-xs font-mono font-bold text-slate-600">{genConfig.numSmurfingInstances}</span>
                        </div>
                      </div>

                      <div className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/50">
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={genConfig.injectRapidPassThrough}
                              onChange={e => setGenConfig(prev => ({ ...prev, injectRapidPassThrough: e.target.checked }))}
                              className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                            />
                            Rapid Mule Pass-Through
                          </label>
                          <span className="text-[10px] font-bold text-rose-700 font-mono bg-rose-100 px-1.5 rounded">Pattern B</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-[10px] text-slate-400">Count to plant</span>
                          <input
                            type="range"
                            min="1"
                            max="7"
                            disabled={!genConfig.injectRapidPassThrough}
                            value={genConfig.numRapidPassThroughInstances}
                            onChange={e => setGenConfig(prev => ({ ...prev, numRapidPassThroughInstances: parseInt(e.target.value) }))}
                            className="flex-1 accent-rose-500 h-1 bg-slate-200 rounded"
                          />
                          <span className="text-xs font-mono font-bold text-slate-600">{genConfig.numRapidPassThroughInstances}</span>
                        </div>
                      </div>

                      <div className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/50">
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={genConfig.injectCircularFlow}
                              onChange={e => setGenConfig(prev => ({ ...prev, injectCircularFlow: e.target.checked }))}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            Circular Flow Loops
                          </label>
                          <span className="text-[10px] font-bold text-indigo-700 font-mono bg-indigo-100 px-1.5 rounded">Pattern C</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-[10px] text-slate-400">Count to plant</span>
                          <input
                            type="range"
                            min="1"
                            max="7"
                            disabled={!genConfig.injectCircularFlow}
                            value={genConfig.numCircularFlowInstances}
                            onChange={e => setGenConfig(prev => ({ ...prev, numCircularFlowInstances: parseInt(e.target.value) }))}
                            className="flex-1 accent-indigo-500 h-1 bg-slate-200 rounded"
                          />
                          <span className="text-xs font-mono font-bold text-slate-600">{genConfig.numCircularFlowInstances}</span>
                        </div>
                      </div>

                      <div className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/50">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-800">Near-miss Sequences (Noise)</span>
                          <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Hard Decoys</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 mt-2">
                          <span className="text-[10px] text-slate-400">Decoys count</span>
                          <input
                            type="range"
                            min="0"
                            max="30"
                            step="2"
                            value={genConfig.numNearMisses}
                            onChange={e => setGenConfig(prev => ({ ...prev, numNearMisses: parseInt(e.target.value) }))}
                            className="flex-1 accent-slate-600 h-1 bg-slate-200 rounded"
                          />
                          <span className="text-xs font-mono font-bold text-slate-600">{genConfig.numNearMisses}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRegenerate()}
                      disabled={isRegenerating}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-700 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer shadow-sm mt-4"
                    >
                      <RefreshCw className={`h-4 w-4 ${isRegenerating ? 'animate-spin' : ''}`} />
                      {isRegenerating ? 'Compiling Graph...' : 'Regenerate Network'}
                    </button>
                  </div>
                )}

                {/* B. DETECTOR THRESHOLDS CONFIGURATION */}
                {controlTab === 'detector' && (
                  <div className="space-y-5">
                    
                    <div className="p-3 border border-amber-200 rounded-lg bg-amber-50/50">
                      <span className="text-xs font-extrabold text-amber-800 font-mono block mb-2">Structuring Filters (Smurfing)</span>
                      
                      <div className="space-y-2 text-xs">
                        <div>
                          <div className="flex justify-between text-slate-500 mb-0.5">
                            <span>Window Size (Hours)</span>
                            <span className="font-mono font-bold text-slate-800">{detConfig.smurfingWindowSeconds / 3600}h</span>
                          </div>
                          <input
                            type="range"
                            min="6"
                            max="120"
                            step="6"
                            value={detConfig.smurfingWindowSeconds / 3600}
                            onChange={e => setDetConfig(prev => ({ ...prev, smurfingWindowSeconds: parseInt(e.target.value) * 3600 }))}
                            className="w-full h-1 accent-amber-500 bg-slate-200 rounded"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-slate-500 mb-0.5">
                            <span>Min Transactions Count</span>
                            <span className="font-mono font-bold text-slate-800">≥ {detConfig.smurfingMinCount} txs</span>
                          </div>
                          <input
                            type="range"
                            min="4"
                            max="25"
                            value={detConfig.smurfingMinCount}
                            onChange={e => setDetConfig(prev => ({ ...prev, smurfingMinCount: parseInt(e.target.value) }))}
                            className="w-full h-1 accent-amber-500 bg-slate-200 rounded"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-slate-500 mb-0.5">
                            <span>Reporting Limit</span>
                            <span className="font-mono font-bold text-slate-800">&lt; {detConfig.smurfingReportingThreshold.toLocaleString()}</span>
                          </div>
                          <input
                            type="range"
                            min="100000"
                            max="2000000"
                            step="100000"
                            value={detConfig.smurfingReportingThreshold}
                            onChange={e => setDetConfig(prev => ({ ...prev, smurfingReportingThreshold: parseInt(e.target.value) }))}
                            className="w-full h-1 accent-amber-500 bg-slate-200 rounded"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="p-3 border border-rose-200 rounded-lg bg-rose-50/50">
                      <span className="text-xs font-extrabold text-rose-800 font-mono block mb-2">Mule Pass-Through Filters</span>
                      
                      <div className="space-y-2 text-xs">
                        <div>
                          <div className="flex justify-between text-slate-500 mb-0.5">
                            <span>Pass Window (Minutes)</span>
                            <span className="font-mono font-bold text-slate-800">{detConfig.passThroughWindowSeconds / 60}m</span>
                          </div>
                          <input
                            type="range"
                            min="5"
                            max="120"
                            step="5"
                            value={detConfig.passThroughWindowSeconds / 60}
                            onChange={e => setDetConfig(prev => ({ ...prev, passThroughWindowSeconds: parseInt(e.target.value) * 60 }))}
                            className="w-full h-1 accent-rose-500 bg-slate-200 rounded"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-slate-500 mb-0.5">
                            <span>Amount Deviation</span>
                            <span className="font-mono font-bold text-slate-800">± {(detConfig.passThroughAmountTolerance * 100).toFixed(0)}%</span>
                          </div>
                          <input
                            type="range"
                            min="0.01"
                            max="0.15"
                            step="0.01"
                            value={detConfig.passThroughAmountTolerance}
                            onChange={e => setDetConfig(prev => ({ ...prev, passThroughAmountTolerance: parseFloat(e.target.value) }))}
                            className="w-full h-1 accent-rose-500 bg-slate-200 rounded"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-slate-500 mb-0.5">
                            <span>Max Chain Depth</span>
                            <span className="font-mono font-bold text-slate-800">{detConfig.passThroughMaxChainLength} hops</span>
                          </div>
                          <input
                            type="range"
                            min="2"
                            max="6"
                            value={detConfig.passThroughMaxChainLength}
                            onChange={e => setDetConfig(prev => ({ ...prev, passThroughMaxChainLength: parseInt(e.target.value) }))}
                            className="w-full h-1 accent-rose-500 bg-slate-200 rounded"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="p-3 border border-indigo-200 rounded-lg bg-indigo-50/50">
                      <span className="text-xs font-extrabold text-indigo-800 font-mono block mb-2">Circular Loop Filters</span>
                      
                      <div className="space-y-2 text-xs">
                        <div>
                          <div className="flex justify-between text-slate-500 mb-0.5">
                            <span>Max Circle Span (Hours)</span>
                            <span className="font-mono font-bold text-slate-800">{detConfig.circularWindowSeconds / 3600}h</span>
                          </div>
                          <input
                            type="range"
                            min="12"
                            max="168"
                            step="12"
                            value={detConfig.circularWindowSeconds / 3600}
                            onChange={e => setDetConfig(prev => ({ ...prev, circularWindowSeconds: parseInt(e.target.value) * 3600 }))}
                            className="w-full h-1 accent-indigo-500 bg-slate-200 rounded"
                          />
                        </div>

                        <div>
                          <div className="flex justify-between text-slate-500 mb-0.5">
                            <span>Max Skim rate per hop</span>
                            <span className="font-mono font-bold text-slate-800">≤ {(detConfig.circularSkimTolerance * 100).toFixed(0)}%</span>
                          </div>
                          <input
                            type="range"
                            min="0.01"
                            max="0.10"
                            step="0.01"
                            value={detConfig.circularSkimTolerance}
                            onChange={e => setDetConfig(prev => ({ ...prev, circularSkimTolerance: parseFloat(e.target.value) }))}
                            className="w-full h-1 accent-indigo-500 bg-slate-200 rounded"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-slate-400 bg-slate-50 p-2.5 rounded border border-slate-200 font-sans leading-normal">
                      <Info className="h-3.5 w-3.5 inline mr-1 text-slate-400 align-text-bottom" />
                      Adjusting detection thresholds dynamically re-runs audit scripts against the current transaction ledger.
                    </div>

                  </div>
                )}
              </div>
            </div>

            {/* DETAILED LEDGER / SEARCH FILTER */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center justify-between">
                <span>Accounts Explorer Ledger</span>
                <span className="text-[10px] font-mono text-slate-400">Total: {dataset.graph.accounts.size}</span>
              </h3>

              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search Account (e.g. ACC_0045)..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-4 py-2 text-xs font-mono focus:bg-white focus:outline-none focus:border-slate-400"
                />
              </div>

              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-2">
                {filteredAccounts.map(acc => {
                  const outCount = dataset.graph.outgoing.get(acc.id)?.length || 0;
                  const inCount = dataset.graph.incoming.get(acc.id)?.length || 0;
                  const isFlagged = flaggedDetails.accountRoles.has(acc.id);
                  const isSelected = selectedAccountId === acc.id;

                  return (
                    <button
                      key={acc.id}
                      onClick={() => {
                        setSelectedAccountId(acc.id);
                        setSelectedFinding(null);
                        setSelectedPlanted(null);
                        
                        const roles = flaggedDetails.accountRoles.get(acc.id);
                        if (roles && roles.length > 0) {
                          const match = findings.find(f => f.id === roles[0].fid);
                          if (match) setSelectedFinding(match);
                        }
                      }}
                      className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs font-mono transition border
                        ${isSelected ? 'bg-blue-50 border-blue-200 text-blue-950 font-bold' : 
                          isFlagged ? 'bg-red-50/50 border-red-100 text-slate-800 hover:bg-slate-100' : 
                          'bg-white border-transparent hover:bg-slate-100 text-slate-600'}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {isFlagged ? (
                          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                        ) : (
                          <span className="h-2 w-2 rounded-full bg-slate-300" />
                        )}
                        {acc.id}
                      </span>
                      <span className="text-[10px] text-slate-400 font-sans">
                        S: {outCount} | R: {inCount}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* RIGHT PANEL: VISUALISATION HUB & INSPECTOR */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* LARGE AUDIT VISUALISATION CANVAS / DIAGRAM CONTAINER */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/50 px-5 py-3">
                
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setActiveTab('graph')}
                    className={`py-1.5 px-3.5 text-xs font-bold rounded-lg transition-all
                      ${activeTab === 'graph' ? 'bg-white text-slate-900 border border-slate-200 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                  >
                    Interactive Network Map
                  </button>
                  <button
                    onClick={() => setActiveTab('subgraph')}
                    className={`py-1.5 px-3.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5
                      ${activeTab === 'subgraph' ? 'bg-white text-slate-900 border border-slate-200 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                  >
                    <Maximize2 className="h-3 w-3 text-slate-400" />
                    Focused Flow schematic
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showFlaggedOnly}
                      onChange={e => setShowFlaggedOnly(e.target.checked)}
                      className="rounded border-slate-300 text-red-600 focus:ring-red-500"
                    />
                    <Layers className="h-3.5 w-3.5 text-slate-400" />
                    Show Flagged Only
                  </label>
                </div>
              </div>

              {/* STAGE CONTAINER */}
              <div className="relative bg-[#f8fafc]">
                
                {activeTab === 'graph' ? (
                  <div className="relative">
                    <canvas
                      ref={canvasRef}
                      onMouseDown={handleCanvasMouseDown}
                      onMouseMove={handleCanvasMouseMove}
                      onMouseUp={handleCanvasMouseUp}
                      onMouseLeave={() => setIsDragging(false)}
                      className="w-full h-[460px] cursor-grab active:cursor-grabbing block"
                    />

                    {/* CANVAS FLOATING WIDGETS */}
                    {/* Zoom / Pan Controller overlay */}
                    <div className="absolute bottom-4 left-4 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-lg p-1.5 flex items-center gap-1 shadow-sm">
                      <button
                        onClick={handleZoomIn}
                        title="Zoom In"
                        className="p-1.5 hover:bg-slate-100 rounded text-slate-600 font-bold text-xs"
                      >
                        +
                      </button>
                      <button
                        onClick={handleZoomOut}
                        title="Zoom Out"
                        className="p-1.5 hover:bg-slate-100 rounded text-slate-600 font-bold text-xs"
                      >
                        -
                      </button>
                      <button
                        onClick={handleZoomReset}
                        className="px-2 py-1 hover:bg-slate-100 rounded text-[10px] font-bold text-slate-500 font-mono"
                      >
                        Reset ({Math.round(zoom * 100)}%)
                      </button>
                    </div>

                    <div className="absolute bottom-4 right-4 bg-slate-900/90 text-white border border-slate-800 rounded-lg py-1 px-2.5 text-[9px] font-mono shadow">
                      Drag background to PAN | Hover & Click nodes to INSPECT
                    </div>

                    {/* HOVER TOOLTIP OVERLAY */}
                    {hoveredNodeId && (
                      <div
                        className="absolute z-40 bg-slate-950/95 text-white p-3 rounded-lg border border-slate-800 shadow-xl text-xs font-mono max-w-xs pointer-events-none"
                        style={{
                          left: `${mousePos.x - canvasRef.current!.getBoundingClientRect().left + 15}px`,
                          top: `${mousePos.y - canvasRef.current!.getBoundingClientRect().top + 15}px`,
                        }}
                      >
                        <div className="font-bold text-blue-400 border-b border-slate-800 pb-1 mb-1 flex justify-between items-center">
                          <span>{hoveredNodeId}</span>
                          {flaggedDetails.accountRoles.has(hoveredNodeId) && (
                            <span className="text-[9px] bg-red-950 text-red-400 px-1.5 rounded border border-red-900">
                              FLAGGED FRAUD
                            </span>
                          )}
                        </div>
                        <div className="space-y-0.5 text-[11px] text-slate-300">
                          <p>Sent transfers: {dataset.graph.outgoing.get(hoveredNodeId)?.length || 0}</p>
                          <p>Received transfers: {dataset.graph.incoming.get(hoveredNodeId)?.length || 0}</p>
                          {flaggedDetails.accountRoles.has(hoveredNodeId) && (
                            <p className="text-amber-400 mt-1.5 font-sans leading-snug">
                              Role: {flaggedDetails.accountRoles.get(hoveredNodeId)?.map(r => r.type.replace(/_/g, ' ')).join(', ')}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="p-4 bg-[#f8fafc] min-h-[460px] flex items-center justify-center">
                    {renderSubgraphVisualiser()}
                  </div>
                )}

              </div>
            </div>

            {/* TAB LISTINGS: ALERTS (FINDINGS) VS PLANTED TRUTH */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="flex border-b border-slate-200 bg-slate-50/50 p-1">
                <button
                  onClick={() => setListingTab('detected')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-bold rounded-lg transition-all
                    ${listingTab === 'detected' ? 'bg-white text-blue-800 shadow-sm font-extrabold border-b border-blue-100' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  <ShieldAlert className="h-4 w-4 text-red-500" />
                  Flagged Audit Alerts ({findings.length})
                </button>
                <button
                  onClick={() => setListingTab('planted')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-bold rounded-lg transition-all
                    ${listingTab === 'planted' ? 'bg-white text-indigo-800 shadow-sm font-extrabold border-b border-indigo-100' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  <CheckCircle className="h-4 w-4 text-indigo-500" />
                  Planted Ground Truth Cases ({plantedPatternsCombined.length})
                </button>
              </div>

              {/* LISTS SCROLLING TABLE CONTAINER */}
              <div className="p-4 max-h-[300px] overflow-y-auto">
                
                {/* A. DETECTED ALERTS TABLE */}
                {listingTab === 'detected' && (
                  <div className="space-y-3">
                    {findings.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                        <CheckCircle className="h-8 w-8 text-emerald-500 mb-2 stroke-[1.5]" />
                        <p className="text-sm font-bold text-slate-700">No Fraud Patterns Flagged</p>
                        <p className="text-xs text-slate-400 mt-0.5">The current ledger passes all handwritten filter criteria</p>
                      </div>
                    ) : (
                      findings.map(f => {
                        const style = getPatternStyles(f.patternType);
                        const isSelected = selectedFinding?.id === f.id;

                        return (
                          <div
                            key={f.id}
                            onClick={() => {
                              setSelectedFinding(f);
                              setSelectedPlanted(null);
                              setSelectedAccountId(f.accountIds[0]);
                              setActiveTab('subgraph'); // instantly hop to schematics
                            }}
                            className={`p-3 rounded-xl border transition-all text-left text-xs cursor-pointer flex justify-between items-start gap-4 hover:shadow-sm
                              ${isSelected ? 'bg-blue-50/70 border-blue-200 ring-1 ring-blue-100' : 'bg-slate-50/50 border-slate-200 hover:bg-slate-50'}`}
                          >
                            <div className="space-y-1.5 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono font-black text-slate-900 bg-slate-200 px-1.5 py-0.5 rounded text-[10px]">
                                  {f.id}
                                </span>
                                <span className={`px-2 py-0.5 rounded font-bold text-[9px] uppercase border ${style.badge}`}>
                                  {style.label}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  ({f.accountIds.length} accs | {f.transactionIds.length} txs)
                                </span>
                              </div>
                              <p className="text-slate-600 font-sans leading-relaxed text-[11px]">
                                {f.explanation}
                              </p>
                            </div>

                            <div className="text-right flex flex-col items-end shrink-0 justify-between h-full gap-2">
                              <div className="flex items-center gap-1 font-mono font-extrabold text-[11px] text-red-600 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded">
                                <span className="text-[9px] uppercase font-sans font-bold text-slate-400 block tracking-wide">Confidence:</span>
                                <span>{(f.score * 100).toFixed(0)}%</span>
                              </div>
                              <span className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5 font-bold">
                                Visualize flow →
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {/* B. PLANTED GROUND TRUTH TABLE */}
                {listingTab === 'planted' && (
                  <div className="space-y-3">
                    {plantedPatternsCombined.map((p, idx) => {
                      const style = getPatternStyles(p.type);
                      const isSelected = selectedPlanted?.pattern.patternId === p.pattern.patternId;

                      return (
                        <div
                          key={p.pattern.patternId}
                          onClick={() => {
                            setSelectedPlanted({ pattern: p.pattern, type: p.type });
                            setSelectedFinding(null);
                            setSelectedAccountId(p.pattern.accountIds[0]);
                            setActiveTab('subgraph');
                          }}
                          className={`p-3 rounded-xl border transition-all text-left text-xs cursor-pointer flex justify-between items-center gap-4 hover:shadow-sm
                            ${isSelected ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-100' : 'bg-slate-50/50 border-slate-200 hover:bg-slate-50'}`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold text-slate-800">
                                {p.pattern.patternId}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[9px] uppercase font-bold border ${style.badge}`}>
                                {style.label}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              Nodes: {p.pattern.accountIds.join(', ')}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            {p.detected ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded-full">
                                <CheckCircle className="h-3 w-3 stroke-[3]" /> Detected
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-100 border border-rose-300 px-2 py-0.5 rounded-full">
                                <CircleAlert className="h-3 w-3 animate-bounce" /> Missed Leg
                              </span>
                            )}
                            <span className="text-[10px] text-indigo-600 font-bold hover:underline">
                              See planted trace
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

              </div>
            </div>

            {/* EXPANDED INSPECTOR DETAIL SHEET (Bottom) */}
            <AnimatePresence mode="wait">
              {selectedAccountId && (
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 15 }}
                  className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <span className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400 block font-mono">Ledger Inspector</span>
                      <h4 className="text-sm font-bold text-slate-900 font-mono flex items-center gap-2">
                        {selectedAccountId}
                        {flaggedDetails.accountRoles.has(selectedAccountId) && (
                          <span className="bg-red-50 text-red-700 border border-red-100 font-bold text-[9px] rounded px-1.5 py-0.5 font-sans">
                            Flagged Leg Node
                          </span>
                        )}
                      </h4>
                    </div>
                    <button
                      onClick={() => setSelectedAccountId(null)}
                      className="text-xs text-slate-400 hover:text-slate-600 font-semibold"
                    >
                      Clear inspector ×
                    </button>
                  </div>

                  {/* Node Specific transaction history table */}
                  <div className="space-y-2">
                    <span className="text-xs font-bold text-slate-700 block">Transaction Ledger (Chronological)</span>
                    
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs font-mono">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
                            <th className="p-2 font-semibold">TX ID</th>
                            <th className="p-2 font-semibold">Direction</th>
                            <th className="p-2 font-semibold">Counterparty</th>
                            <th className="p-2 font-semibold">Timestamp</th>
                            <th className="p-2 font-semibold text-right">Amount (LCU)</th>
                            <th className="p-2 font-semibold text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            // Fetch both sent and received
                            const outTxs = dataset.graph.outgoing.get(selectedAccountId) || [];
                            const inTxs = dataset.graph.incoming.get(selectedAccountId) || [];
                            const combined = [
                              ...outTxs.map(t => ({ ...t, direction: 'SENT' })),
                              ...inTxs.map(t => ({ ...t, direction: 'RECEIVED' }))
                            ].sort((a, b) => a.timestamp - b.timestamp);

                            if (combined.length === 0) {
                              return (
                                <tr>
                                  <td colSpan={6} className="p-4 text-center text-slate-400 font-sans italic">
                                    No transaction logs available for this account
                                  </td>
                                </tr>
                              );
                            }

                            return combined.map(tx => {
                              const isFraudLeg = flaggedDetails.transactionRoles.has(tx.id);
                              const fraudRole = flaggedDetails.transactionRoles.get(tx.id);
                              const dirText = tx.direction === 'SENT' ? 'Outward' : 'Inward';
                              const counterpart = tx.direction === 'SENT' ? tx.toAccountId : tx.fromAccountId;
                              
                              // Format UTC-like time
                              const timeStr = new Date(tx.timestamp * 1000).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: false
                              });

                              return (
                                <tr
                                  key={tx.id}
                                  className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors
                                    ${isFraudLeg ? 'bg-red-50/20' : ''}`}
                                >
                                  <td className="p-2 font-bold">{tx.id}</td>
                                  <td className={`p-2 font-sans font-bold text-[10px] ${tx.direction === 'SENT' ? 'text-amber-600' : 'text-emerald-600'}`}>
                                    {dirText}
                                  </td>
                                  <td className="p-2 font-bold text-slate-700">{counterpart}</td>
                                  <td className="p-2 text-slate-500 font-sans">{timeStr}</td>
                                  <td className="p-2 text-right font-bold text-slate-800">{tx.amount.toLocaleString()}</td>
                                  <td className="p-2 text-center font-sans">
                                    {isFraudLeg ? (
                                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-100 text-red-800 border border-red-200">
                                        <AlertTriangle className="h-2.5 w-2.5" /> Flagged
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-100 text-slate-600">
                                        Normal
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </motion.div>
              )}
            </AnimatePresence>

          </div>

        </section>

      </main>

      {/* FOOTER METADATA */}
      <footer className="mt-auto bg-white border-t border-slate-200 py-6 px-6 text-center text-xs text-slate-400 font-sans space-y-1">
        <p>© 2026 Mobile Money Pattern Visualizer | Built in React 19 & Vite with tailwindcss</p>
        <p className="font-mono text-[10px]">No runtime external graph dependencies. All cycles and structured structured flows solved via recursive DFS.</p>
      </footer>
    </div>
  );
}
