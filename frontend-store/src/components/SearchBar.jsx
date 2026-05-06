import { useState, useEffect, useRef } from 'react'
import { Search, Loader2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../config'

function SearchBar() {
    const [query, setQuery] = useState('')
    const [suggestions, setSuggestions] = useState([])
    const [isLoading, setIsLoading] = useState(false)
    const [isOpen, setIsOpen] = useState(false)
    const [activeIndex, setActiveIndex] = useState(-1)

    const navigate = useNavigate()
    const containerRef = useRef(null)
    const debounceTimer = useRef(null)

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const fetchSuggestions = async (searchQuery) => {
        if (!searchQuery.trim()) {
            setSuggestions([])
            setIsLoading(false)
            return
        }
        setIsLoading(true)
        try {
            const res = await fetch(`${API_BASE_URL}/products/search?q=${encodeURIComponent(searchQuery)}`)
            const data = await res.json()
            setSuggestions(data)
        } catch (err) {
            console.error('Search error:', err)
        } finally {
            setIsLoading(false)
        }
    }

    const handleInputChange = (e) => {
        const value = e.target.value
        setQuery(value)
        setIsOpen(true)
        setActiveIndex(-1)

        if (debounceTimer.current) clearTimeout(debounceTimer.current)

        debounceTimer.current = setTimeout(() => {
            fetchSuggestions(value)
        }, 300)
    }

    const handleKeyDown = (e) => {
        if (!isOpen || suggestions.length === 0) return

        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActiveIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0))
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActiveIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1))
        } else if (e.key === 'Enter') {
            e.preventDefault()
            if (activeIndex >= 0) {
                handleSelect(suggestions[activeIndex])
            }
        } else if (e.key === 'Escape') {
            setIsOpen(false)
        }
    }

    const handleSelect = (product) => {
        setQuery('')
        setIsOpen(false)
        setSuggestions([])
        navigate(`/product/${product.id}`)
    }

    const clearSearch = () => {
        setQuery('')
        setSuggestions([])
        setIsOpen(false)
    }

    return (
        <div ref={containerRef} className="relative w-full group md:max-w-xl">
            <div className="relative flex items-center">
                <Search className={`absolute left-3 w-4 h-4 transition-colors ${isLoading ? 'text-primary' : 'text-gray-400 group-focus-within:text-primary'}`} />
                <input
                    type="text"
                    value={query}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => query.trim() && setIsOpen(true)}
                    placeholder="Search products..."
                    className="w-full bg-white/20 border border-white/40 rounded-2xl pl-11 pr-10 py-3 text-sm focus:outline-none focus:bg-white/80 transition-all backdrop-blur-md placeholder:text-primary/40 text-primary font-bold shadow-sm"
                />
                {isLoading ? (
                    <Loader2 className="absolute right-3 w-4 h-4 text-primary animate-spin" />
                ) : query && (
                    <button onClick={clearSearch} className="absolute right-3 p-1 hover:bg-gray-200 rounded-full transition-colors">
                        <X className="w-3 h-3 text-gray-500" />
                    </button>
                )}
            </div>

            {isOpen && (query.trim()) && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur-md border border-gray-100 rounded-2xl shadow-2xl overflow-hidden z-[60] animate-in fade-in slide-in-from-top-2 duration-200">
                    {suggestions.length > 0 ? (
                        <div className="max-h-[70vh] overflow-y-auto">
                            <div className="px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-50">
                                Matching Products
                            </div>
                            {suggestions.map((product, index) => (
                                <button
                                    key={product.id}
                                    onClick={() => handleSelect(product)}
                                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${activeIndex === index ? 'bg-primary/10' : 'hover:bg-gray-50'}`}
                                >
                                    <div className="w-10 h-10 bg-white rounded-lg border border-gray-100 flex-shrink-0 p-1">
                                        <img src={product.images} alt={product.name} className="w-full h-full object-contain" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-semibold text-gray-800 truncate">{product.name}</div>
                                        <div className="text-[10px] text-gray-500 flex items-center gap-2">
                                            <span>₹{product.price}</span>
                                            {product.category_name && (
                                                <>
                                                    <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                                                    <span>{product.category_name}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        !isLoading && (
                            <div className="px-4 py-8 text-center">
                                <Search className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                                <p className="text-sm text-gray-500">No products found for "{query}"</p>
                            </div>
                        )
                    )}
                </div>
            )}
        </div>
    )
}

export default SearchBar
