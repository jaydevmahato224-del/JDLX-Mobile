import { useEffect } from 'react';

/**
 * SEO Component to dynamically update meta tags for social sharing.
 * Safely updates Open Graph and Twitter tags in the DOM.
 */
const SEO = ({ title, description, image, url, price }) => {
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const fullTitle = `${title} | JDLX MOBILE`;
    const fullDescription = price 
      ? `Buy ${title} for only ₹${price}. ${description || 'Premium mobile accessory from JDLX.'}`
      : description;

    // Standard Tags
    document.title = fullTitle;
    updateMetaTag('name', 'description', fullDescription);

    // Open Graph Tags
    updateMetaTag('property', 'og:title', fullTitle);
    updateMetaTag('property', 'og:description', fullDescription);
    updateMetaTag('property', 'og:image', image);
    updateMetaTag('property', 'og:url', url || window.location.href);
    updateMetaTag('property', 'og:type', 'product');
    updateMetaTag('property', 'og:site_name', 'JDLX MOBILE');

    // Twitter Tags
    updateMetaTag('name', 'twitter:card', 'summary_large_image');
    updateMetaTag('name', 'twitter:title', fullTitle);
    updateMetaTag('name', 'twitter:description', fullDescription);
    updateMetaTag('name', 'twitter:image', image);
    updateMetaTag('name', 'twitter:url', url || window.location.href);

  }, [title, description, image, url, price]);

  return null;
};

/**
 * Helper to update or create a meta tag.
 */
const updateMetaTag = (attr, value, content) => {
  if (!content) return;
  
  let element = document.querySelector(`meta[${attr}="${value}"]`);
  
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attr, value);
    document.head.appendChild(element);
  }
  
  element.setAttribute('content', content);
};

export default SEO;
