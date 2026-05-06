import { useState, useEffect, useCallback } from 'react'
import { API_BASE_URL } from '../config'
import categoryPrefetchService from '../services/categoryPrefetchService'

function CategoryGrid({ onCategorySelect, activeCategory }) {
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchCategories = async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/categories`);
                const data = await response.json();
                setCategories(data);
                setLoading(false);

                // Prefetch all categories products on initial load
                if (data.length > 0) {
                    // Defer prefetch to not block initial render
                    requestIdleCallback(() => {
                        categoryPrefetchService.prefetchAllCategories(data)
                    })
                }
            } catch (error) {
                console.error("Error fetching categories:", error);
                setLoading(false);
            }
        };

        fetchCategories();
    }, []);

    /**
     * Handle category hover - prefetch products on demand
     */
    const handleCategoryHover = useCallback((categoryId) => {
        if (categoryId) {
            categoryPrefetchService.prefetchWithDebounce(categoryId, 20, 150)
        }
    }, [])

    /**
     * Handle category hover leave - cancel pending prefetch
     */
    const handleCategoryHoverLeave = useCallback((categoryId) => {
        if (categoryId) {
            categoryPrefetchService.cancelPrefetch(categoryId)
        }
    }, [])

    if (loading) {
        return (
            <div className="flex gap-4 overflow-x-auto pb-2 no-scrollbar">
                {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex-shrink-0 w-20 flex flex-col gap-2 animate-pulse">
                        <div className="w-20 h-20 bg-gray-200 rounded-2xl"></div>
                        <div className="h-3 bg-gray-200 rounded w-16 mx-auto"></div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <h3 className="text-lg font-bold text-gray-800 px-1">Shop by Category</h3>
            <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar -mx-1 px-1">
                <button
                    onClick={() => onCategorySelect(null)}
                    className="flex-shrink-0 w-20 flex flex-col items-center gap-2 group"
                >
                    <div className={`w-20 h-20 rounded-2xl flex items-center justify-center transition-all duration-300 ${!activeCategory ? 'bg-primary ring-4 ring-primary/20 scale-95 shadow-lg' : 'bg-white shadow-sm border border-gray-100 group-hover:shadow-md'}`}>
                        <span className={`text-2xl ${!activeCategory ? 'text-white' : 'text-gray-400'}`}>🛍️</span>
                    </div>
                    <span className={`text-[11px] font-bold text-center leading-tight transition-colors ${!activeCategory ? 'text-primary' : 'text-gray-600'}`}>All Items</span>
                </button>

                {categories.map((category) => (
                    <button
                        key={category.id}
                        onClick={() => onCategorySelect(category.id)}
                        onMouseEnter={() => handleCategoryHover(category.id)}
                        onMouseLeave={() => handleCategoryHoverLeave(category.id)}
                        onTouchStart={() => handleCategoryHover(category.id)}
                        onTouchEnd={() => handleCategoryHoverLeave(category.id)}
                        className="flex-shrink-0 w-20 flex flex-col items-center gap-2 group"
                    >
                        <div className={`w-20 h-20 rounded-2xl overflow-hidden transition-all duration-300 ${activeCategory === category.id ? 'ring-4 ring-primary/20 scale-95 shadow-lg' : 'shadow-sm border border-gray-100 group-hover:shadow-md'}`}>
                            <img
                                src={category.icon}
                                alt={category.name}
                                loading="lazy"
                                className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-110 ${activeCategory === category.id ? 'opacity-100' : 'opacity-90 hover:opacity-100'}`}
                            />
                        </div>
                        <span className={`text-[11px] font-bold text-center leading-tight transition-colors ${activeCategory === category.id ? 'text-primary' : 'text-gray-600'}`}>
                            {category.name}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}

export default CategoryGrid;
