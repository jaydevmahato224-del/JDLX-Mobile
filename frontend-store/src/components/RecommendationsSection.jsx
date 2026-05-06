import { useEffect, useMemo, useState, memo } from 'react';
import { Sparkles, ChevronRight, Star, ShoppingBag, Zap } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import BlurImage from './BlurImage';
import { API_BASE_URL, resolveMediaUrl } from '../config';
import toast from 'react-hot-toast';
import { useStore } from '../store/useStore';
import { isStickerProduct } from '../utils/stickerCustomization';

function extractFirstMediaUrl(value) {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    return extractFirstMediaUrl(value[0]);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return extractFirstMediaUrl(parsed[0]);
      }
      if (typeof parsed === 'string') {
        return extractFirstMediaUrl(parsed);
      }
      if (parsed && typeof parsed === 'object') {
        return extractFirstMediaUrl(parsed.url || parsed.src || parsed.image || parsed.image_url);
      }
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

const RecommendedCard = memo(({ product, onAddToCart }) => {
  const navigate = useNavigate();
  const resolvedUrl = useMemo(() => {
    const imageCandidate =
      extractFirstMediaUrl(product.image_url) ||
      extractFirstMediaUrl(product.images) ||
      extractFirstMediaUrl(product.image) ||
      extractFirstMediaUrl(product.thumbnail);

    if (!imageCandidate) {
      return `https://placehold.co/400x400/0D1B2A/FFFFFF?text=${encodeURIComponent(product.name)}`;
    }

    try {
      return resolveMediaUrl(imageCandidate);
    } catch {
      return imageCandidate;
    }
  }, [product.image, product.image_url, product.images, product.name, product.thumbnail]);

  const discount = product.mrp > product.price 
    ? Math.round(((product.mrp - product.price) / product.mrp) * 100) 
    : 0;

  return (
    <div className="perf-card flex-shrink-0 w-[280px] group relative glass-luxury rounded-[32px] overflow-hidden border-white/40 transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl">
      <div className="relative aspect-[4/5] overflow-hidden">
        <Link to={`/product/${product.id}`} className="block h-full w-full">
          <BlurImage
            src={resolvedUrl}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
          />
        </Link>
        <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
          {product.average_rating > 0 && (
            <div className="px-3 py-1 bg-white/60 backdrop-blur-xl rounded-full border border-white/40 flex items-center gap-1 w-fit">
              <Star size={10} className="text-amber-500 fill-amber-500" />
              <span className="text-[10px] font-black">{Number(product.average_rating).toFixed(1)}</span>
            </div>
          )}
          {discount > 0 && (
            <div className="px-3 py-1 bg-red-500 text-white text-[10px] font-black rounded-full shadow-lg animate-pulse-soft w-fit">
              SAVE {discount}%
            </div>
          )}
        </div>
        <button 
          onClick={() => {
            if (isStickerProduct(product)) {
              toast('Select your device model on the product page');
              navigate(`/product/${product.id}`);
              return;
            }
            onAddToCart(product);
            toast.success(`${product.name} added!`);
          }}
          className="absolute bottom-4 right-4 w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center shadow-lg translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 active:scale-90"
        >
          <ShoppingBag size={20} />
        </button>
      </div>
      <div className="p-5">
        <span className="text-[10px] font-black uppercase tracking-widest text-primary/60 mb-1 block">
          {product.category || 'Featured Deal'}
        </span>
        <h3 className="text-sm font-bold text-slate-900 mb-2 line-clamp-1 group-hover:text-primary transition-colors">
          {product.name}
        </h3>
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-lg font-black text-slate-900">₹{product.price}</span>
            {product.mrp > product.price && (
              <span className="text-[10px] text-slate-400 line-through">₹{product.mrp}</span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[10px] font-bold text-red-500">
             <Sparkles size={12} className="text-red-400" />
             Best Deal
          </div>
        </div>
      </div>
    </div>
  );
});

export default function RecommendationsSection() {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const addToCart = useStore(state => state.addToCart);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_BASE_URL}/products/recommendations?limit=8`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Recommendations request failed with ${response.status}`);
        }

        const text = await response.text();
        if (!text.trim()) {
          return { success: true, data: [] };
        }

        return JSON.parse(text);
      })
      .then((res) => {
        if (!res || typeof res !== 'object') {
          setRecommendations([]);
          return;
        }

        // Sort by discount for Best Deals
        const data = res.success && Array.isArray(res.data) ? res.data : [];
        const sorted = data.sort((a, b) => {
          const discA = a.mrp > a.price ? (a.mrp - a.price) / a.mrp : 0;
          const discB = b.mrp > b.price ? (b.mrp - b.price) / b.mrp : 0;
          return discB - discA;
        });

        setRecommendations(sorted);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Failed to load recommendations', err);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  if (!loading && recommendations.length === 0) return null;

  return (
    <section className="py-12 md:py-20 reveal-in">
      <div className="flex flex-col gap-8">
        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Zap size={16} className="text-amber-500 fill-amber-500" />
              <span className="ui-label text-amber-600">Limited Time Offers</span>
            </div>
            <h2 className="ui-h2 text-slate-900">Best Deals For You</h2>
          </div>
          <Link to="/search" className="hidden sm:flex items-center gap-2 text-sm font-bold text-primary group">
            Explore All Deals <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>

        <div className="flex gap-6 overflow-x-auto pb-8 no-scrollbar -mx-6 px-6 sm:mx-0 sm:px-0">
          {loading ? (
             [...Array(4)].map((_, i) => (
               <div key={i} className="flex-shrink-0 w-[280px] h-[400px] bg-slate-100/50 rounded-[32px] animate-pulse" />
             ))
          ) : (
            recommendations.map(product => (
              <RecommendedCard key={product.id} product={product} onAddToCart={addToCart} />
            ))
          )}
        </div>
      </div>
    </section>
  );
}
