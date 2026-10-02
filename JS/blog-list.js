/**
 * ZIFT STUDIO — Dinamik Blog Listeleme & Yönlendirme Mantığı
 * Hem 'pages/yazı.html' (Tam Makale Listesi) hem 'index.html' (Bento Grid) Uyumlu
 */

// Sayfa yüklenir yüklenmez kartları görünür kıl (Reveal animasyonu bekletilmesin)
function ensureAllCardsVisible() {
  document.querySelectorAll('.article-card, .blog-card').forEach(el => {
    el.classList.add('visible');
    el.classList.add('active');
  });
}

// DOMContentLoaded ve anında çağır
ensureAllCardsVisible();
document.addEventListener('DOMContentLoaded', () => {
  ensureAllCardsVisible();
  initDynamicBlogList();
});

async function initDynamicBlogList() {
  ensureAllCardsVisible();

  const articleListContainer = document.querySelector('.article-list');
  const blogGridContainer = document.getElementById('dynamicBlogContainer') || document.querySelector('.blog-grid');

  if (!articleListContainer && !blogGridContainer) return;

  try {
    if (!window.BlogService) {
      console.warn('BlogService hazır değil, statik içerik gösteriliyor.');
      ensureAllCardsVisible();
      return;
    }

    // 1. Yazıları Supabase'den çek
    const posts = await window.BlogService.getPosts({ limit: 50 });

    if (!posts || posts.length === 0) {
      ensureAllCardsVisible();
      return;
    }

    // 2. Eğer 'pages/yazı.html' sayfasındaysak (Tam Makale Listesi)
    if (articleListContainer) {
      syncArticleListWithSupabase(articleListContainer, posts);
      updateFilterBarCounts(posts);
      if (typeof initBlogExpansion === 'function') {
        initBlogExpansion();
      }
      if (typeof initBlogLightbox === 'function') {
        initBlogLightbox();
      }
    }

    // 3. Eğer 'index.html' veya Bento Grid alanındaysak
    if (blogGridContainer) {
      renderBentoBlogCards(blogGridContainer, posts.slice(0, 3));
    }

  } catch (error) {
    console.warn('Supabase dinamik blog listesi yüklenemedi, statik içerik korunuyor:', error);
  } finally {
    ensureAllCardsVisible();
  }
}

/**
 * 'pages/yazı.html' Sayfasındaki Makaleleri Supabase ile Senkronize Eder
 * (Mevcut zengin galerileri ve alıntıları korur, Admin panelinden eklenen yeni yazıları başa ekler)
 */
function syncArticleListWithSupabase(container, posts) {
  const isInPagesDir = window.location.pathname.includes('/pages/');
  const detailBaseUrl = isInPagesDir ? 'blog-detay.html' : 'pages/blog-detay.html';

  // 1. Mevcut DOM kartlarını slug'a göre haritala ve gerçek görüntülenme sayılarını eşle
  const existingCards = container.querySelectorAll('.article-card');
  const existingSlugs = new Set();
  const postMap = new Map();
  posts.forEach(p => { if (p && p.slug) postMap.set(p.slug, p); });

  existingCards.forEach(card => {
    const slug = card.getAttribute('data-slug');
    if (slug) {
      existingSlugs.add(slug);
      const post = postMap.get(slug);
      if (post) {
        const metaGroup = card.querySelector('.article-meta-group');
        if (metaGroup) {
          let viewsEl = metaGroup.querySelector('.article-views-count');
          if (!viewsEl) {
            const sep = document.createElement('span');
            sep.textContent = '•';
            viewsEl = document.createElement('span');
            viewsEl.className = 'article-views-count';
            metaGroup.appendChild(sep);
            metaGroup.appendChild(viewsEl);
          }
          const v = typeof post.views === 'number' ? post.views : 0;
          viewsEl.textContent = `👁️ ${v.toLocaleString('tr-TR')}`;
        }
      }
    }
    card.classList.add('visible');
    card.classList.add('active');
  });

  // 2. Admin panelinden eklenmiş YENİ yazılar varsa en başa ekle
  posts.slice().reverse().forEach(post => {
    if (!existingSlugs.has(post.slug)) {
      const formattedDate = formatTurkishDate(post.created_at);
      const categoryInfo = getCategoryMeta(post.category);
      let coverImage = post.image_url || '';

      if (coverImage) {
        if (isInPagesDir && !coverImage.startsWith('../') && !coverImage.startsWith('http') && !coverImage.startsWith('/')) {
          coverImage = '../' + coverImage;
        } else if (!isInPagesDir && coverImage.startsWith('../')) {
          coverImage = coverImage.replace(/^\.\.\//, '');
        }
      } else {
        coverImage = isInPagesDir ? '../assets/image/randevu/randevu-1.png' : 'assets/image/randevu/randevu-1.png';
      }

      const readTime = post.read_time || '4 dk okuma';
      const detailLink = `${detailBaseUrl}?slug=${encodeURIComponent(post.slug)}`;

      let parsedContent = '';
      if (window.marked && typeof window.marked.parse === 'function') {
        parsedContent = window.marked.parse(post.content || '');
      } else {
        parsedContent = post.content || '';
      }
      if (window.sanitizeHtml && typeof window.sanitizeHtml === 'function') {
        parsedContent = window.sanitizeHtml(parsedContent);
      }

      const newArticle = document.createElement('article');
      newArticle.className = 'article-card reveal visible active';
      newArticle.id = `post-${post.slug}`;
      newArticle.setAttribute('data-category', post.category || 'custom');
      newArticle.setAttribute('data-slug', post.slug);

      newArticle.innerHTML = `
        <div class="article-card-header">
          <span class="article-category-badge ${categoryInfo.badgeClass}">
            ${categoryInfo.icon} ${categoryInfo.label}
          </span>
          <div class="article-meta-group">
            <span class="article-reading-time">⏱️ ${escapeHtml(readTime)}</span>
            <span>•</span>
            <time datetime="${escapeHtml(post.created_at)}">${formattedDate}</time>
            <span>•</span>
            <span class="article-views-count">👁️ ${(post.views || 0).toLocaleString('tr-TR')}</span>
          </div>
        </div>

        <h2 class="article-title">${escapeHtml(post.title)}</h2>

        ${coverImage ? `
          <div class="article-cover-wrap">
            <img src="${escapeHtml(coverImage)}" alt="${escapeHtml(post.title)}" class="article-cover-img" loading="lazy">
            <div class="article-cover-caption">
              <span>${categoryInfo.icon} ${escapeHtml(post.title)}</span>
              <a href="${detailLink}" style="color: inherit; text-decoration: none; font-weight: 700;">Detay Sayfası ↗</a>
            </div>
          </div>
        ` : ''}

        <div class="article-content">
          ${post.summary ? `<p class="article-lead">${escapeHtml(post.summary)}</p>` : ''}
          <div class="article-expanded-text">
            ${parsedContent}
          </div>
        </div>

        <div class="article-actions-bar">
          <a href="${detailLink}" class="read-more-btn">
            Devamını Oku
            <svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>
        </div>

        <div class="article-tags-wrap">
          <span class="article-tag-pill">#${escapeHtml(post.category || 'ZiftStudio')}</span>
          <span class="article-tag-pill">#ZiftStudio</span>
          <span class="article-tag-pill">#Mühendislik</span>
          <span class="article-tag-pill">#Blog</span>
        </div>

        <div class="article-author-footer">
          <img src="${isInPagesDir ? '../assets/image/hero-avatar.jpg' : 'assets/image/hero-avatar.jpg'}" alt="Muhammet Ali Kıtır" class="article-author-avatar">
          <div class="article-author-info">
            <span class="article-author-name">Muhammet Ali Kıtır</span>
            <span class="article-author-role">Lead Full-Stack Architect & Founder @ ZiftStudio</span>
          </div>
        </div>
      `;

      container.prepend(newArticle);
    }
  });

  // Tüm kartların görünür olmasını garanti et
  ensureAllCardsVisible();
}

/**
 * 'index.html' İçin Bento Grid Kartlarını Basar
 */
function renderBentoBlogCards(container, posts) {
  const isInPagesDir = window.location.pathname.includes('/pages/');
  const detailBaseUrl = isInPagesDir ? 'blog-detay.html' : 'pages/blog-detay.html';

  container.innerHTML = posts.map(post => {
    const formattedDate = formatTurkishDate(post.created_at);
    const categoryInfo = getCategoryMeta(post.category);
    let coverImage = post.image_url || '';

    if (coverImage) {
      if (isInPagesDir && !coverImage.startsWith('../') && !coverImage.startsWith('http') && !coverImage.startsWith('/')) {
        coverImage = '../' + coverImage;
      } else if (!isInPagesDir && coverImage.startsWith('../')) {
        coverImage = coverImage.replace(/^\.\.\//, '');
      }
    } else {
      coverImage = isInPagesDir ? '../assets/image/randevu/randevu-1.png' : 'assets/image/randevu/randevu-1.png';
    }

    const readTime = post.read_time || '3 dk okuma';
    const detailLink = `${detailBaseUrl}?slug=${encodeURIComponent(post.slug)}`;

    return `
      <div class="blog-card reveal visible active" onclick="window.location.href='${detailLink}'" style="cursor: pointer;" data-slug="${escapeHtml(post.slug)}">
        <div class="blog-thumb">
          <div class="blog-visual" style="background: url('${escapeHtml(coverImage)}') center/cover no-repeat;"></div>
        </div>
        <div class="blog-card-content">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
            <span class="article-category-badge ${categoryInfo.badgeClass}">
              ${categoryInfo.icon} ${categoryInfo.label}
            </span>
            <span class="blog-date" style="margin-bottom: 0;">${formattedDate}</span>
          </div>

          <a href="${detailLink}" class="blog-title" onclick="event.stopPropagation();">${escapeHtml(post.title)}</a>

          <p class="blog-excerpt">
            ${escapeHtml(post.summary || '')}
          </p>

          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding-top: 1rem; border-top: 1px solid var(--border-light);">
            <span style="font-size: 0.75rem; color: var(--text-muted); display: inline-flex; align-items: center; gap: 6px;">
              <span>⏱️ ${escapeHtml(readTime)}</span>
              <span>•</span>
              <span>👁️ ${(post.views || 0).toLocaleString('tr-TR')}</span>
            </span>
            <a href="${detailLink}" class="blog-read" onclick="event.stopPropagation();">
              Oku 
              <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');

  ensureAllCardsVisible();
}

/**
 * Filtreleme Barındaki Yazı Sayılarını Günceller
 */
function updateFilterBarCounts(posts) {
  const allBtn = document.querySelector('.blog-filter-btn[onclick*="\'all\'"]');
  if (allBtn) {
    allBtn.innerHTML = `🌟 Tümü (${posts.length} Yazı)`;
  }
}

/**
 * Kategori Bilgileri
 */
function getCategoryMeta(category) {
  const cat = (category || '').toLowerCase();
  switch (cat) {
    case 'custom':
      return { label: 'Özel Yazılım', badgeClass: 'badge-custom', icon: '⚡' };
    case 'saas':
      return { label: 'SaaS & Araçlar', badgeClass: 'badge-saas', icon: '🚀' };
    case 'community':
      return { label: 'Topluluk & Kamu', badgeClass: 'badge-community', icon: '👥' };
    case 'engineering':
      return { label: 'Mimari & Kod', badgeClass: 'badge-engineering', icon: '🛠️' };
    default:
      return { label: 'Teknoloji', badgeClass: 'badge-custom', icon: '💡' };
  }
}

/**
 * Tarih Formatı
 */
function formatTurkishDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

/**
 * XSS Koruması
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.initDynamicBlogList = initDynamicBlogList;
