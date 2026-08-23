import { useState, useMemo, useEffect } from 'react';
import {
    Plus,
    Trash2,
    Zap,
    Copy,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    ChevronDown,
    ChevronUp,
    Image,
    Tag,
    Settings,
    RotateCcw,
    Grid,
    Layers,
    List,
    Eye,
    EyeOff,
    Link2,
    AlertCircle,
    Info,
    Loader2,
    Save,
    X,
    Check,
    Minus,
    Maximize2,
    Minimize2
} from 'lucide-react';
import { resolveMediaUrl } from '../../../config';

const VARIANT_ID_PREFIX = 'var_';

const generateId = () => `${VARIANT_ID_PREFIX}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const generateSkuFromOptions = (baseSku, options, existingSkus = new Set()) => {
    if (!baseSku || !options || Object.keys(options).length === 0) {
        return '';
    }
    const sortedKeys = Object.keys(options).sort();
    const optionParts = sortedKeys.map(k => {
        const val = String(options[k] || '').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
        return val;
    }).filter(Boolean);
    if (optionParts.length === 0) return '';
    let sku = `${baseSku.toUpperCase()}-${optionParts.join('-')}`;
    let counter = 1;
    let finalSku = sku;
    while (existingSkus.has(finalSku)) {
        finalSku = `${sku}-${counter}`;
        counter++;
    }
    return finalSku;
};

const generateAllCombinations = (optionGroups) => {
    if (!optionGroups || optionGroups.length === 0) return [];
    
    const validGroups = optionGroups.filter(g => 
        g.option_name && g.option_name.trim() && 
        g.option_values && g.option_values.length > 0
    );
    
    if (validGroups.length === 0) return [];
    
    const keys = validGroups.map(g => g.option_name.trim());
    const valuesArrays = validGroups.map(g => 
        g.option_values.filter(v => v && v.toString().trim()).map(v => v.toString().trim())
    );
    
    const combine = (arrays, index = 0, current = {}) => {
        if (index === arrays.length) {
            return [current];
        }
        const results = [];
        for (const value of arrays[index]) {
            results.push(...combine(arrays, index + 1, { ...current, [keys[index]]: value }));
        }
        return results;
    };
    
    return combine(valuesArrays);
};

const validateVariant = (variant, optionGroups, allVariants, currentIndex) => {
    const errors = [];
    const warnings = [];
    
    if (!variant.options || Object.keys(variant.options).length === 0) {
        errors.push('Variant must have at least one option selected');
    }
    
    if (optionGroups && optionGroups.length > 0) {
        const requiredOptions = optionGroups
            .filter(g => g.option_name && g.option_name.trim())
            .map(g => g.option_name.trim());
        
        for (const reqOpt of requiredOptions) {
            if (!variant.options[reqOpt] || !variant.options[reqOpt].toString().trim()) {
                errors.push(`Missing required option: ${reqOpt}`);
            }
        }
        
        for (const [key, value] of Object.entries(variant.options)) {
            const group = optionGroups.find(g => g.option_name.trim() === key);
            if (group) {
                const allowedValues = group.option_values.map(v => v.toString().trim());
                if (!allowedValues.includes(value.toString().trim())) {
                    errors.push(`Invalid value for ${key}: "${value}". Allowed: ${allowedValues.join(', ')}`);
                }
            } else {
                warnings.push(`Unknown option group: ${key}`);
            }
        }
    }
    
    if (!variant.sku || !variant.sku.trim()) {
        errors.push('SKU is required');
    } else {
        const duplicate = allVariants.find((v, i) => i !== currentIndex && v.sku === variant.sku);
        if (duplicate) {
            errors.push(`Duplicate SKU: ${variant.sku}`);
        }
    }
    
    const duplicateCombo = allVariants.find((v, i) => i !== currentIndex && 
        JSON.stringify(v.options) === JSON.stringify(variant.options));
    if (duplicateCombo) {
        errors.push('Duplicate variant combination (same options)');
    }
    
    if (variant.price === undefined || variant.price === null || variant.price === '') {
        warnings.push('Price not set - will use base product price');
    }
    
    if (variant.stock_quantity === undefined || variant.stock_quantity === null || variant.stock_quantity === '') {
        warnings.push('Stock not set - defaults to 0');
    }
    
    if (variant.mrp !== undefined && variant.mrp !== null && variant.mrp !== '' && variant.price !== undefined && variant.price !== null && variant.price !== '') {
        if (parseFloat(variant.mrp) < parseFloat(variant.price)) {
            warnings.push('MRP is lower than selling price');
        }
    }
    
    return { errors, warnings, isValid: errors.length === 0 };
};

const VariantManager = ({
    baseProduct,
    variantOptions,
    variants,
    onChange,
    onGenerateVariants,
    disabled = false,
    isEditing = false
}) => {
    const [expandedSections, setExpandedSections] = useState({
        options: true,
        generator: true,
        variants: true
    });
    const [generating, setGenerating] = useState(false);
    const [previewCombinations, setPreviewCombinations] = useState([]);
    const [showPreview, setShowPreview] = useState(false);
    const [validationCache, setValidationCache] = useState({});
    const [editingVariantIndex, setEditingVariantIndex] = useState(null);
    const [showImagesModal, setShowImagesModal] = useState({ index: -1, images: [] });
    const [_unsavedChanges, _setUnsavedChanges] = useState(false);

    const existingSkus = useMemo(() => 
        new Set(variants.filter(v => v.sku).map(v => v.sku.toUpperCase())), 
    [variants]);

    const allOptionGroups = useMemo(() => 
        variantOptions.filter(g => g.option_name && g.option_name.trim() && g.option_values && g.option_values.length > 0),
    [variantOptions]);

    useEffect(() => {
        const combos = generateAllCombinations(allOptionGroups);
        setPreviewCombinations(combos.map((options, index) => ({
            options,
            suggestedSku: generateSkuFromOptions(baseProduct?.global_sku_code || baseProduct?.sku || 'PRD', options, existingSkus),
            index
        })));
    }, [allOptionGroups, baseProduct?.global_sku_code, baseProduct?.sku, existingSkus]);

    useEffect(() => {
        const cache = {};
        variants.forEach((variant, index) => {
            cache[index] = validateVariant(variant, allOptionGroups, variants, index);
        });
        setValidationCache(cache);
    }, [variants, allOptionGroups]);

    const handleOptionGroupChange = (groupIndex, field, value) => {
        const newOptions = [...variantOptions];
        newOptions[groupIndex] = { ...newOptions[groupIndex], [field]: value };
        onChange({ variantOptions: newOptions });
    };

    const handleAddOptionGroup = () => {
        const newOptions = [...variantOptions, { option_name: '', option_values: [], sort_order: variantOptions.length }];
        onChange({ variantOptions: newOptions });
        setExpandedSections(prev => ({ ...prev, options: true }));
    };

    const handleRemoveOptionGroup = (groupIndex) => {
        if (!window.confirm('Remove this option group? This will affect variant generation.')) return;
        const newOptions = variantOptions.filter((_, i) => i !== groupIndex);
        onChange({ variantOptions: newOptions });
    };

    const handleOptionValueChange = (groupIndex, valueIndex, value) => {
        const newOptions = [...variantOptions];
        const newValues = [...newOptions[groupIndex].option_values];
        newValues[valueIndex] = value;
        newOptions[groupIndex] = { ...newOptions[groupIndex], option_values: newValues };
        onChange({ variantOptions: newOptions });
    };

    const handleAddOptionValue = (groupIndex) => {
        const newOptions = [...variantOptions];
        newOptions[groupIndex] = { 
            ...newOptions[groupIndex], 
            option_values: [...newOptions[groupIndex].option_values, ''] 
        };
        onChange({ variantOptions: newOptions });
    };

    const handleRemoveOptionValue = (groupIndex, valueIndex) => {
        const newOptions = [...variantOptions];
        newOptions[groupIndex] = { 
            ...newOptions[groupIndex], 
            option_values: newOptions[groupIndex].option_values.filter((_, i) => i !== valueIndex) 
        };
        onChange({ variantOptions: newOptions });
    };

    const handleGenerateVariants = async () => {
        if (generating) return;
        setGenerating(true);
        try {
            await onGenerateVariants(previewCombinations);
            setShowPreview(false);
            _setUnsavedChanges(true);
        } finally {
            setGenerating(false);
        }
    };

    const handleAddManualVariant = () => {
        const _baseSku = baseProduct?.global_sku_code || baseProduct?.sku || 'PRD';
        const newVariant = {
            id: generateId(),
            name: '',
            sku: '',
            price: baseProduct?.price || 0,
            mrp: null,
            stock_quantity: 0,
            options: {},
            images: [],
            status: 'active'
        };
        onChange({ variants: [...variants, newVariant] });
        _setUnsavedChanges(true);
        setEditingVariantIndex(variants.length);
    };

    const handleVariantChange = (index, field, value) => {
        const newVariants = [...variants];
        if (field === 'options') {
            newVariants[index] = { ...newVariants[index], options: value };
        } else if (field === 'images') {
            newVariants[index] = { ...newVariants[index], images: value };
        } else {
            newVariants[index] = { ...newVariants[index], [field]: value };
        }
        
        if (field === 'options' && newVariants[index].sku) {
            const newSku = generateSkuFromOptions(
                baseProduct?.global_sku_code || baseProduct?.sku || 'PRD',
                value,
                new Set(newVariants.filter((_, i) => i !== index).map(v => v.sku?.toUpperCase()))
            );
            if (newSku) {
                newVariants[index].sku = newSku;
            }
        }
        
        onChange({ variants: newVariants });
        _setUnsavedChanges(true);
    };

    const handleRemoveVariant = (index) => {
        if (!window.confirm('Remove this variant?')) return;
        const newVariants = variants.filter((_, i) => i !== index);
        onChange({ variants: newVariants });
        if (editingVariantIndex === index) setEditingVariantIndex(null);
        _setUnsavedChanges(true);
    };

    const handleDuplicateVariant = (index) => {
        const variant = { ...variants[index], id: generateId(), sku: '' };
        const newVariants = [...variants];
        newVariants.splice(index + 1, 0, variant);
        onChange({ variants: newVariants });
        _setUnsavedChanges(true);
    };

    const handleToggleEditing = (index) => {
        setEditingVariantIndex(editingVariantIndex === index ? null : index);
    };

    const handleToggleVariantStatus = (index) => {
        const newVariants = [...variants];
        newVariants[index] = { 
            ...newVariants[index], 
            status: newVariants[index].status === 'active' ? 'inactive' : 'active' 
        };
        onChange({ variants: newVariants });
        _setUnsavedChanges(true);
    };

    const handleImageUpload = (variantIndex, files) => {
        const variant = variants[variantIndex];
        const currentImages = variant.images || [];
        const newImages = [...currentImages];
        
        const filePromises = Array.from(files).map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(file);
            });
        });
        
        Promise.all(filePromises).then(uploadedUrls => {
            const updatedImages = [...newImages, ...uploadedUrls].slice(0, 10);
            handleVariantChange(variantIndex, 'images', updatedImages);
        });
    };

    const _handleRemoveImage = (variantIndex, imageIndex) => {
        const variant = variants[variantIndex];
        const newImages = (variant.images || []).filter((_, i) => i !== imageIndex);
        handleVariantChange(variantIndex, 'images', newImages);
    };

    const _handleReorderImage = (variantIndex, fromIndex, toIndex) => {
        const variant = variants[variantIndex];
        const newImages = [...(variant.images || [])];
        const [removed] = newImages.splice(fromIndex, 1);
        newImages.splice(toIndex, 0, removed);
        handleVariantChange(variantIndex, 'images', newImages);
    };

    const _handlePasteOptions = (index, text) => {
        try {
            const options = {};
            text.split(',').forEach(part => {
                const idx = part.indexOf(':');
                if (idx > 0) {
                    const key = part.slice(0, idx).trim();
                    const value = part.slice(idx + 1).trim();
                    if (key && value) options[key] = value;
                }
            });
            if (Object.keys(options).length > 0) {
                handleVariantChange(index, 'options', options);
            }
        } catch (e) {
            console.error('Failed to parse options:', e);
        }
    };

    const getValidation = (index) => validationCache[index] || { errors: [], warnings: [], isValid: true };

    const renderOptionGroups = () => (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-300">Option Groups</h4>
                <button
                    type="button"
                    onClick={handleAddOptionGroup}
                    disabled={disabled}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 text-amber-400 text-xs font-semibold uppercase tracking-wider hover:bg-amber-400/20 transition-colors disabled:opacity-50"
                >
                    <Plus size={12} /> Add Option Group
                </button>
            </div>
            
            {variantOptions.length === 0 && (
                <div className="p-6 text-center bg-slate-800/30 border border-dashed border-white/10 rounded-xl">
                    <Zap className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                    <p className="text-sm text-slate-500">No option groups defined</p>
                    <p className="text-xs text-slate-600 mt-1">Add groups like Color, Size, Storage to generate variants</p>
                </div>
            )}
            
            {variantOptions.map((group, gi) => (
                <div key={gi} className="bg-slate-800/30 border border-white/5 rounded-xl p-4 animate-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center gap-3 mb-3">
                        <input
                            type="text"
                            placeholder="Option name (e.g. Color, Size)"
                            value={group.option_name}
                            onChange={(e) => handleOptionGroupChange(gi, 'option_name', e.target.value)}
                            disabled={disabled}
                            className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-semibold focus:outline-none focus:border-amber-400/50 transition-colors"
                        />
                        <span className="text-xs text-slate-500 uppercase tracking-wider">
                            Sort: {group.sort_order ?? gi}
                        </span>
                        <button
                            type="button"
                            onClick={() => handleRemoveOptionGroup(gi)}
                            disabled={disabled}
                            className="p-2 text-slate-500 hover:text-rose-400 transition-colors disabled:opacity-50"
                            title="Remove option group"
                        >
                            <Trash2 size={16} />
                        </button>
                    </div>
                    
                    <div className="space-y-2">
                        {group.option_values.map((value, vi) => (
                            <div key={vi} className="flex items-center gap-2">
                                <input
                                    type="text"
                                    placeholder={`Value ${vi + 1} (e.g. Black, 128GB)`}
                                    value={value}
                                    onChange={(e) => handleOptionValueChange(gi, vi, e.target.value)}
                                    disabled={disabled}
                                    className="flex-1 bg-slate-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white font-medium focus:outline-none focus:border-amber-400/50 transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => handleRemoveOptionValue(gi, vi)}
                                    disabled={disabled}
                                    className="p-2 text-slate-500 hover:text-rose-400 transition-colors disabled:opacity-50"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={() => handleAddOptionValue(gi)}
                            disabled={disabled}
                            className="w-full flex items-center justify-center gap-2 py-2 text-sm text-slate-400 hover:text-amber-400 border border-dashed border-white/10 rounded-lg transition-colors disabled:opacity-50"
                        >
                            <Plus size={14} /> Add Value
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );

    const renderVariantGenerator = () => {
        const totalCombinations = previewCombinations.length;
        const hasOptionGroups = allOptionGroups.length > 0;
        
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-300">Generate Variants</h4>
                    {hasOptionGroups && totalCombinations > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowPreview(!showPreview)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/50 text-slate-300 text-xs font-semibold uppercase tracking-wider hover:bg-slate-800 transition-colors"
                        >
                            {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            {showPreview ? 'Hide Preview' : `Preview (${totalCombinations})`}
                        </button>
                    )}
                </div>

                {!hasOptionGroups && (
                    <div className="p-6 text-center bg-slate-800/30 border border-dashed border-white/10 rounded-xl">
                        <Info className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                        <p className="text-sm text-slate-500">Define option groups first to generate variants</p>
                    </div>
                )}

                {hasOptionGroups && totalCombinations === 0 && (
                    <div className="p-6 text-center bg-rose-400/10 border border-rose-400/20 rounded-xl">
                        <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto mb-2" />
                        <p className="text-sm text-rose-300">Each option group must have at least one value</p>
                    </div>
                )}

                {hasOptionGroups && totalCombinations > 0 && (
                    <div className="p-4 bg-slate-800/30 border border-white/5 rounded-xl">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-medium text-slate-300">
                                {totalCombinations} combination{totalCombinations !== 1 ? 's' : ''} will be created
                            </span>
                            <button
                                type="button"
                                onClick={handleGenerateVariants}
                                disabled={disabled || generating || variants.length >= 100}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-400 text-slate-950 text-sm font-bold hover:bg-amber-300 transition-colors disabled:opacity-50"
                            >
                                {generating ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                                {generating ? 'Generating...' : 'Generate All'}
                            </button>
                        </div>
                        
                        {showPreview && (
                            <div className="max-h-64 overflow-y-auto space-y-2">
                                {previewCombinations.slice(0, 20).map((combo, i) => (
                                    <div key={i} className="flex items-center gap-3 p-2 bg-slate-900/50 border border-white/5 rounded-lg">
                                        <span className="w-6 text-center text-xs text-slate-500">{i + 1}</span>
                                        <div className="flex-1 flex flex-wrap gap-1">
                                            {Object.entries(combo.options).map(([k, v]) => (
                                                <span key={k} className="px-2 py-0.5 bg-amber-400/10 text-amber-400 text-xs rounded">
                                                    {k}: {v}
                                                </span>
                                            ))}
                                        </div>
                                        <span className="font-mono text-xs text-slate-400 bg-slate-900 px-2 py-0.5 rounded">
                                            {combo.suggestedSku || '—'}
                                        </span>
                                    </div>
                                ))}
                                {totalCombinations > 20 && (
                                    <div className="text-center text-xs text-slate-500 py-2">
                                        + {totalCombinations - 20} more combinations
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const renderVariantsTable = () => {
        if (variants.length === 0) {
            return (
                <div className="text-center py-12 bg-slate-800/30 border border-dashed border-white/10 rounded-xl">
                    <Grid className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-500">No variants created yet</p>
                    <p className="text-xs text-slate-600 mt-1">Use the generator above or add manually</p>
                    <button
                        type="button"
                        onClick={handleAddManualVariant}
                        disabled={disabled}
                        className="mt-4 flex items-center gap-2 mx-auto px-4 py-2 rounded-lg bg-amber-400/10 text-amber-400 text-sm font-semibold hover:bg-amber-400/20 transition-colors disabled:opacity-50"
                    >
                        <Plus size={14} /> Add First Variant Manually
                    </button>
                </div>
            );
        }

        const columns = [
            { key: 'status', label: '', width: 'w-10' },
            { key: 'name', label: 'Variant Name', width: 'flex-1 min-w-[150px]' },
            { key: 'options', label: 'Options', width: 'flex-1 min-w-[180px]' },
            { key: 'sku', label: 'SKU', width: 'w-[140px]' },
            { key: 'price', label: 'Price', width: 'w-[90px]' },
            { key: 'mrp', label: 'MRP', width: 'w-[90px]' },
            { key: 'stock', label: 'Stock', width: 'w-[80px]' },
            { key: 'images', label: 'Images', width: 'w-[80px]' },
            { key: 'actions', label: '', width: 'w-[120px]' }
        ];

        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-300">
                        Variants ({variants.length})
                        {variants.length > 0 && (
                            <span className="ml-2 px-2 py-0.5 bg-slate-800 rounded text-xs text-slate-400">
                                {variants.filter(v => v.status === 'active').length} active
                            </span>
                        )}
                    </h4>
                    <button
                        type="button"
                        onClick={handleAddManualVariant}
                        disabled={disabled || variants.length >= 100}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/50 text-slate-300 text-xs font-semibold uppercase tracking-wider hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                        <Plus size={12} /> Add Manual
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-white/10">
                                {columns.map(col => (
                                    <th key={col.key} className={`${col.width} px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500`}>
                                        {col.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {variants.map((variant, index) => {
                                const validation = getValidation(index);
                                const _isEditing = editingVariantIndex === index;
                                const hasErrors = validation.errors.length > 0;
                                const _hasWarnings = validation.warnings.length > 0;

                                return (
                                    <tr key={variant.id} className={`group transition-colors ${hasErrors ? 'bg-rose-400/5' : ''} ${isEditing ? 'bg-amber-400/5' : ''}`}>
                                        <td className="px-3 py-3">
                                            <button
                                                type="button"
                                                onClick={() => handleToggleVariantStatus(index)}
                                                disabled={disabled}
                                                className={`w-2.5 h-2.5 rounded-full transition-colors ${variant.status === 'active' ? 'bg-emerald-400' : 'bg-slate-600'}`}
                                                title={variant.status === 'active' ? 'Active - click to disable' : 'Inactive - click to enable'}
                                            />
                                        </td>
                                        
                                        <td className="px-3 py-3">
                                            <input
                                                type="text"
                                                placeholder="e.g. Black / 128GB"
                                                value={variant.name || ''}
                                                onChange={(e) => handleVariantChange(index, 'name', e.target.value)}
                                                disabled={disabled}
                                                className={`w-full bg-transparent border-none px-2 py-1 text-sm text-white font-medium focus:outline-none focus:ring-2 focus:ring-amber-400/30 rounded ${hasErrors ? 'border-b-2 border-rose-400' : ''}`}
                                            />
                                        </td>
                                        
                                        <td className="px-3 py-3">
                                            {_isEditing && allOptionGroups.length > 0 ? (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {allOptionGroups.map((g) => {
                                                        const gName = g.option_name.trim();
                                                        return (
                                                            <select
                                                                key={gName}
                                                                value={(variant.options && variant.options[gName]) || ''}
                                                                onChange={(e) => {
                                                                    const next = { ...(variant.options || {}) };
                                                                    if (e.target.value) next[gName] = e.target.value;
                                                                    else delete next[gName];
                                                                    handleVariantChange(index, 'options', next);
                                                                }}
                                                                disabled={disabled}
                                                                className="bg-slate-900 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-white font-semibold focus:outline-none focus:border-amber-400/50"
                                                            >
                                                                <option value="">{gName}…</option>
                                                                {g.option_values.map((val) => (
                                                                    <option key={val} value={val}>{gName}: {val}</option>
                                                                ))}
                                                            </select>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="flex flex-wrap gap-1">
                                                    {Object.entries(variant.options || {}).map(([k, v]) => (
                                                        <span key={k} className="px-2 py-0.5 bg-slate-700/50 border border-white/10 text-[10px] font-medium rounded">
                                                            <span className="text-slate-400">{k}:</span> {v}
                                                        </span>
                                                    ))}
                                                    {(!variant.options || Object.keys(variant.options).length === 0) && (
                                                        <span className="text-xs text-slate-600 italic">No options</span>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                        
                                        <td className="px-3 py-3">
                                            <input
                                                type="text"
                                                placeholder="SKU"
                                                value={variant.sku || ''}
                                                onChange={(e) => handleVariantChange(index, 'sku', e.target.value.toUpperCase())}
                                                disabled={disabled}
                                                className={`w-full bg-transparent border-none px-2 py-1 text-xs font-mono text-white font-bold uppercase focus:outline-none focus:ring-2 focus:ring-amber-400/30 rounded ${validation.errors.some(e => e.includes('SKU')) ? 'border-b-2 border-rose-400' : ''}`}
                                            />
                                        </td>
                                        
                                        <td className="px-3 py-3">
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                placeholder="Price"
                                                value={variant.price ?? ''}
                                                onChange={(e) => handleVariantChange(index, 'price', e.target.value)}
                                                disabled={disabled}
                                                className="w-full bg-transparent border-none px-2 py-1 text-sm text-amber-400 font-bold text-right focus:outline-none"
                                            />
                                        </td>
                                        
                                        <td className="px-3 py-3">
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                placeholder="MRP"
                                                value={variant.mrp ?? ''}
                                                onChange={(e) => handleVariantChange(index, 'mrp', e.target.value)}
                                                disabled={disabled}
                                                className="w-full bg-transparent border-none px-2 py-1 text-xs text-slate-400 font-medium text-right focus:outline-none"
                                            />
                                        </td>
                                        
                                        <td className="px-3 py-3">
                                            <input
                                                type="number"
                                                min="0"
                                                step="1"
                                                placeholder="Qty"
                                                value={variant.stock_quantity ?? ''}
                                                onChange={(e) => handleVariantChange(index, 'stock_quantity', e.target.value)}
                                                disabled={disabled}
                                                className="w-full bg-transparent border-none px-2 py-1 text-sm text-emerald-400 font-bold text-center focus:outline-none"
                                            />
                                        </td>
                                        
                                        <td className="px-3 py-3">
                                            <div className="flex items-center gap-1">
                                                <span className="text-xs text-slate-500">
                                                    {(variant.images || []).length}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowImagesModal({ index, images: variant.images || [] })}
                                                    disabled={disabled}
                                                    className="p-1.5 text-slate-500 hover:text-amber-400 transition-colors disabled:opacity-50"
                                                    title="Manage images"
                                                >
                                                    <Image size={14} />
                                                </button>
                                            </div>
                                        </td>
                                        
                                        <td className="px-3 py-3">
                                            <div className="flex items-center gap-1 justify-end">
                                                {isEditing ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleToggleEditing(index)}
                                                            className="p-1.5 bg-emerald-400/10 text-emerald-400 rounded hover:bg-emerald-400/20 transition-colors"
                                                            title="Done editing"
                                                        >
                                                            <Check size={14} />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleToggleEditing(index)}
                                                            className="p-1.5 text-slate-500 hover:text-amber-400 transition-colors disabled:opacity-50"
                                                            title="Edit variant"
                                                        >
                                                            <Settings size={14} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDuplicateVariant(index)}
                                                            disabled={disabled || variants.length >= 100}
                                                            className="p-1.5 text-slate-500 hover:text-blue-400 transition-colors disabled:opacity-50"
                                                            title="Duplicate variant"
                                                        >
                                                            <Copy size={14} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveVariant(index)}
                                                            disabled={disabled}
                                                            className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors disabled:opacity-50"
                                                            title="Remove variant"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </>
                                                )}
                                                </div>
                                            </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {(validationCache && Object.keys(validationCache).length > 0) && (
                    <div className="p-4 bg-slate-800/30 border border-white/5 rounded-xl">
                        <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className="w-4 h-4 text-amber-400" />
                            <span className="text-sm font-semibold text-slate-300">Validation Summary</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                            <div className="p-3 bg-rose-400/10 border border-rose-400/20 rounded-lg">
                                <div className="flex items-center gap-1.5 text-rose-400 mb-1">
                                    <XCircle size={12} /> Errors
                                </div>
                                <div className="space-y-1">
                                    {Object.entries(validationCache).flatMap(([idx, v]) => 
                                        v.errors.map(e => (
                                            <div key={`${idx}-${e}`} className="flex items-center gap-1">
                                                <span className="text-slate-500">#{parseInt(idx)+1}:</span>
                                                <span className="text-rose-300">{e}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                            <div className="p-3 bg-amber-400/10 border border-amber-400/20 rounded-lg">
                                <div className="flex items-center gap-1.5 text-amber-400 mb-1">
                                    <AlertTriangle size={12} /> Warnings
                                </div>
                                <div className="space-y-1">
                                    {Object.entries(validationCache).flatMap(([idx, v]) => 
                                        v.warnings.map(w => (
                                            <div key={`${idx}-${w}`} className="flex items-center gap-1">
                                                <span className="text-slate-500">#{parseInt(idx)+1}:</span>
                                                <span className="text-amber-300">{w}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                            <div className="p-3 bg-emerald-400/10 border border-emerald-400/20 rounded-lg">
                                <div className="flex items-center gap-1.5 text-emerald-400 mb-1">
                                    <CheckCircle2 size={12} /> Valid
                                </div>
                                <div className="text-center text-emerald-300">
                                    {Object.values(validationCache).filter(v => v.isValid).length} / {variants.length} variants valid
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const _toggleSection = (section) => {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-amber-400/5 to-indigo-400/5 border border-amber-400/10 rounded-xl">
                <div className="p-2 rounded-lg bg-amber-400/20 text-amber-500">
                    <Layers size={20} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white">Product Variants</h3>
                    <p className="text-xs text-slate-400">Define options, generate combinations, manage individual variants</p>
                </div>
            </div>

            <div className="space-y-4">
                <details className="group" open={expandedSections.options}>
                    <summary className="flex items-center justify-between p-4 bg-slate-800/30 border border-white/5 rounded-xl cursor-pointer list-none">
                        <div className="flex items-center gap-3">
                            <Settings className="w-5 h-5 text-amber-400" />
                            <div>
                                <h4 className="font-semibold text-slate-200">Product Options</h4>
                                <p className="text-xs text-slate-500">{variantOptions.length} group{variantOptions.length !== 1 ? 's' : ''} defined</p>
                            </div>
                        </div>
                        <ChevronDown className="w-5 h-5 text-slate-500 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="p-4 border-t border-white/5">
                        {renderOptionGroups()}
                    </div>
                </details>

                <details className="group" open={expandedSections.generator}>
                    <summary className="flex items-center justify-between p-4 bg-slate-800/30 border border-white/5 rounded-xl cursor-pointer list-none">
                        <div className="flex items-center gap-3">
                            <Zap className="w-5 h-5 text-indigo-400" />
                            <div>
                                <h4 className="font-semibold text-slate-200">Variant Generator</h4>
                                <p className="text-xs text-slate-500">{previewCombinations.length} combination{previewCombinations.length !== 1 ? 's' : ''} ready</p>
                            </div>
                        </div>
                        <ChevronDown className="w-5 h-5 text-slate-500 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="p-4 border-t border-white/5">
                        {renderVariantGenerator()}
                    </div>
                </details>

                <details className="group" open={expandedSections.variants}>
                    <summary className="flex items-center justify-between p-4 bg-slate-800/30 border border-white/5 rounded-xl cursor-pointer list-none">
                        <div className="flex items-center gap-3">
                            <Grid className="w-5 h-5 text-emerald-400" />
                            <div>
                                <h4 className="font-semibold text-slate-200">Variants Table</h4>
                                <p className="text-xs text-slate-500">{variants.length} variant{variants.length !== 1 ? 's' : ''} • {Object.values(validationCache).filter(v => v.isValid).length} valid</p>
                            </div>
                        </div>
                        <ChevronDown className="w-5 h-5 text-slate-500 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="p-4 border-t border-white/5">
                        {renderVariantsTable()}
                    </div>
                </details>
            </div>

            {showImagesModal.index >= 0 && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
                    <div className="w-full max-w-2xl max-h-[80vh] bg-slate-900 border border-white/10 rounded-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-4 border-b border-white/10 flex items-center justify-between">
                            <h4 className="font-semibold text-white">Variant Images - {variants[showImagesModal.index]?.name || 'Variant'}</h4>
                            <button onClick={() => setShowImagesModal({ index: -1, images: [] })} className="p-2 text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto max-h-[60vh]">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                                {showImagesModal.images.map((img, i) => (
                                    <div key={i} className="relative aspect-square rounded-xl bg-slate-800 border border-white/5 overflow-hidden group">
                                        <img src={resolveMediaUrl(img)} alt="" className="w-full h-full object-cover" />
                                        <button
                                            onClick={() => {
                                                const newImages = showImagesModal.images.filter((_, idx) => idx !== i);
                                                handleVariantChange(showImagesModal.index, 'images', newImages);
                                                setShowImagesModal(prev => ({ ...prev, images: newImages }));
                                            }}
                                            className="absolute top-1 right-1 p-1 bg-slate-900/80 text-rose-400 rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-500 hover:text-white"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                ))}
                                {showImagesModal.images.length < 10 && (
                                    <label className="aspect-square rounded-xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-2 text-slate-500 hover:text-amber-400 hover:border-amber-400/30 transition-all bg-white/[0.02] cursor-pointer">
                                        <input type="file" accept="image/*" multiple hidden onChange={(e) => handleImageUpload(showImagesModal.index, e.target.files)} />
                                        <Plus size={24} />
                                        <span className="text-xs font-bold uppercase tracking-wider">Add</span>
                                    </label>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VariantManager;