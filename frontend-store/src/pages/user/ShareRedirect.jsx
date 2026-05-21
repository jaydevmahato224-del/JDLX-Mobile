import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { API_BASE_URL } from '../../config';
import PageLoader from '../../components/PageLoader';

/**
 * ShareRedirect handles incoming short URLs (/s/:token).
 * It fetches the internal product ID and redirects to the full product page.
 */
const ShareRedirect = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchProductByToken = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/products/s/${token}`);
        if (!response.ok) throw new Error('Product not found');
        
        const product = await response.json();
        // Redirect to the actual product page using the secure token format
        const slug = product.name?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'product';
        navigate(`/p/${slug}-${product.share_token || token}`, { replace: true });
      } catch (err) {
        console.error('Failed to resolve share token:', err);
        setError(true);
      }
    };

    fetchProductByToken();
  }, [token, navigate]);

  if (error) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <PageLoader />
        <p className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
          Resolving Premium Link...
        </p>
      </div>
    </div>
  );
};

export default ShareRedirect;
