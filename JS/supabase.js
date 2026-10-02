/**
 * ZIFT STUDIO — Supabase Client & Blog Service Layer
 * Gerçek Okuma İstatistikleri, Veritabanı Servisi, Güvenlik ve CMS Motoru
 * Vanilla JavaScript / UMD Compatible (@supabase/supabase-js v2) + Native REST API Fallback
 */

// 1. Supabase Proje Bilgileri
const SUPABASE_URL = 'https://morzaqwfavflbwjrvzdm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1vcnphcXdmYXZmbGJ3anJ2emRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNDYyMTAsImV4cCI6MjEwNTgyMjIxMH0.kvgpmxTNtEqFkfs08ldKjB2t25fBGgGTSRc8btU8ZyQ';

// 2. Supabase İstemci Başlatıcı (Lazy & Dinamik)
let supabaseClient = null;

function getSupabaseClient() {
  if (!supabaseClient) {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  }
  return supabaseClient;
}

// Global scope export
if (typeof window !== 'undefined') {
  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  window.supabaseClient = supabaseClient;
  window.getSupabaseClient = getSupabaseClient;
}

// 3. Eski Fake / Demo LocalStorage Verilerini Temizleyici
(function cleanupLegacyDemoViews() {
  if (typeof localStorage === 'undefined') return;
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('zift_blog_views_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    // LocalStorage kısıtlı ortamlarda sessiz kal
  }
})();

// 4. Bot & Otomasyon Tespit Fonksiyonu
function isAutomatedBot() {
  if (typeof navigator === 'undefined') return true;

  // Headless browser / webdriver tespiti
  if (navigator.webdriver) return true;

  // Bilinen arama motoru botları ve web crawler desenleri
  const ua = navigator.userAgent || '';
  const botRegex = /bot|spider|crawler|crawl|googlebot|bingbot|yandex|duckduckbot|slurp|baiduspider|facebookexternalhit|twitterbot|rogerbot|linkedinbot|embedly|quora link preview|showyoubot|outbrain|pinterest|slackbot|vkshare|w3c_validator|headless|phantomjs/i;
  if (botRegex.test(ua)) return true;

  // Phantom / Automation belirteçleri
  if (typeof window !== 'undefined') {
    if (window._phantom || window.__nightmare || window.callPhantom) return true;
  }

  return false;
}

// 5. Basit & Güvenli HTML Sanitizer (XSS Önleme)
function sanitizeHtml(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^>]*>(.*?)<\/iframe>/gi, (match, inner) => {
      // Sadece güvenli video embed iframe'lerine izin ver
      if (/src=["'](https:\/\/www\.youtube\.com|https:\/\/player\.vimeo\.com)/i.test(match)) {
        return match;
      }
      return '';
    })
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '') // onclick, onerror vb. kaldır
    .replace(/\son\w+\s*=\s*[^ >]+/gi, '')
    .replace(/javascript:/gi, '');
}

// 6. Blog Nesnesi Standardizasyonu (Veritabanı Uyumlu)
function normalizePost(post) {
  if (!post || typeof post !== 'object') return null;

  // views ve view_count alanlarını senkronize et (doğrudan DB değeri, asla fake değil)
  const rawViews = post.views !== undefined ? post.views : post.view_count;
  const numViews = typeof rawViews === 'number' && !isNaN(rawViews) ? Math.max(0, Math.floor(rawViews)) : 0;
  
  post.views = numViews;
  try {
    Object.defineProperty(post, 'view_count', {
      get() { return this.views; },
      set(v) { this.views = Number(v) || 0; },
      configurable: true,
      enumerable: true
    });
  } catch (e) {
    post.view_count = numViews;
  }

  return post;
}

// Eşzamanlı (in-flight) sayaç istek kilitleri
const activeViewLocks = new Map();

// 7. Ana Blog Servis Motoru (BlogService)
const BlogService = {
  /**
   * Tüm blog yazılarını çeker (kategori ve limit opsiyonlu)
   * @param {Object} options - { category?: string, limit?: number }
   * @returns {Promise<Array>}
   */
  async getPosts({ category = 'all', limit = 50 } = {}) {
    const client = getSupabaseClient();
    let posts = [];

    // Supabase JS İstemcisi ile çek
    if (client) {
      try {
        let query = client
          .from('blogs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (category && category !== 'all') {
          query = query.eq('category', category);
        }

        const { data, error } = await query;
        if (!error && Array.isArray(data)) {
          posts = data;
        }
      } catch (err) {
        console.warn('Supabase Client ile liste çekilemedi, REST deneniyor...', err);
      }
    }

    // REST API Fallback
    if (!posts || posts.length === 0) {
      try {
        let url = `${SUPABASE_URL}/rest/v1/blogs?select=*&order=created_at.desc&limit=${limit}`;
        if (category && category !== 'all') {
          url += `&category=eq.${encodeURIComponent(category)}`;
        }

        const res = await fetch(url, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        if (res.ok) {
          const raw = await res.json();
          if (Array.isArray(raw)) posts = raw;
        }
      } catch (e) {
        console.error('REST API blog çekme hatası:', e);
      }
    }

    return (posts || []).map(normalizePost);
  },

  /**
   * Slug değerine göre tekil bir blog yazısını getirir
   * @param {string} slug 
   * @returns {Promise<Object|null>}
   */
  async getPostBySlug(slug) {
    if (!slug || typeof slug !== 'string') return null;
    const cleanSlug = slug.trim();
    const client = getSupabaseClient();
    let post = null;

    if (client) {
      try {
        const { data, error } = await client
          .from('blogs')
          .select('*')
          .eq('slug', cleanSlug)
          .single();

        if (!error && data) post = data;
      } catch (err) {
        console.warn('Client ile tekil yazı çekilemedi, REST deneniyor...', err);
      }
    }

    // REST Fallback
    if (!post) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/blogs?slug=eq.${encodeURIComponent(cleanSlug)}&select=*`, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        if (res.ok) {
          const rows = await res.json();
          if (Array.isArray(rows) && rows.length > 0) post = rows[0];
        }
      } catch (e) {
        console.error('REST getPostBySlug hatası:', e);
      }
    }

    return post ? normalizePost(post) : null;
  },

  /**
   * Slug'ın veritabanında daha önce kullanılıp kullanılmadığını doğrular
   * @param {string} slug 
   * @param {string|null} excludeId - Güncelleme durumunda kendi ID'sini hariç tut
   * @returns {Promise<boolean>} - true ise slug kullanılabilir (boşta)
   */
  async isSlugAvailable(slug, excludeId = null) {
    if (!slug) return false;
    const cleanSlug = slug.trim();
    const client = getSupabaseClient();

    try {
      if (client) {
        let query = client.from('blogs').select('id').eq('slug', cleanSlug);
        if (excludeId) query = query.neq('id', excludeId);
        const { data, error } = await query;
        if (!error) return !data || data.length === 0;
      }

      // REST Fallback
      let url = `${SUPABASE_URL}/rest/v1/blogs?slug=eq.${encodeURIComponent(cleanSlug)}&select=id`;
      if (excludeId) url += `&id=neq.${encodeURIComponent(excludeId)}`;
      const res = await fetch(url, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      if (res.ok) {
        const rows = await res.json();
        return Array.isArray(rows) && rows.length === 0;
      }
    } catch (e) {
      console.warn('Slug kontrolü yapılamadı:', e);
    }
    return true;
  },

  /**
   * Gerçek ve Atomik Blog Görüntülenme / Okuma Takip Sistemi
   * - Bot / Crawler koruması
   * - Oturum ve 24 saatlik cihaz deduplikasyonu (Sayfa yenileme / F5 spam engeli)
   * - React / Next.js çift tetiklenme (double useEffect) koruması
   * - Veritabanında PostgreSQL SECURITY DEFINER RPC ile atomik +1 artış
   * 
   * @param {string} slug
   * @returns {Promise<{ success: boolean, incremented: boolean, reason?: string }>}
   */
  async incrementViewCount(slug) {
    if (!slug || typeof slug !== 'string') {
      return { success: false, incremented: false, reason: 'invalid_slug' };
    }
    const cleanSlug = slug.trim();

    // 1. Otomatik bot & crawler kontrolü
    if (isAutomatedBot()) {
      return { success: true, incremented: false, reason: 'bot_ignored' };
    }

    // 2. Tarayıcı ön-yükleme (prerender) kontrolü
    if (typeof document !== 'undefined' && document.visibilityState === 'prerender') {
      return { success: true, incremented: false, reason: 'prerender_ignored' };
    }

    // 3. Eşzamanlı in-flight kilit kontrolü (Aynı anda birden fazla tetiklenmeyi engeller)
    if (activeViewLocks.has(cleanSlug)) {
      return await activeViewLocks.get(cleanSlug);
    }

    // 4. Oturum ve Cihaz Tekillik Kontrolü
    const sessionKey = 'zift_read_session_' + cleanSlug;
    const dailyKey = 'zift_read_ts_' + cleanSlug;
    const now = Date.now();

    try {
      // A: Bu tarayıcı oturumunda zaten okundu mu?
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(sessionKey)) {
        return { success: true, incremented: false, reason: 'already_viewed_session' };
      }

      // B: Son 24 saat içinde bu cihazdan okundu mu?
      if (typeof localStorage !== 'undefined') {
        const lastViewTs = localStorage.getItem(dailyKey);
        if (lastViewTs) {
          const diff = now - parseInt(lastViewTs, 10);
          if (diff < 24 * 60 * 60 * 1000) {
            // Son 24 saat içinde zaten sayıldı, tekrar sayma
            return { success: true, incremented: false, reason: 'already_viewed_24h' };
          }
        }
      }
    } catch (storageErr) {
      // LocalStorage kısıtlamalarında devam et
    }

    // 5. İstek Kilidini Başlat ve DB'ye Atomik Artış Gönder
    const executeIncrement = (async () => {
      try {
        // Oturum ve günlük işaretleyicileri yaz
        try {
          if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(sessionKey, '1');
          if (typeof localStorage !== 'undefined') localStorage.setItem(dailyKey, now.toString());
        } catch (e) {}

        const client = getSupabaseClient();
        let rpcSuccess = false;

        // Yöntem A: Supabase Client RPC çağrısı
        if (client) {
          try {
            const { error } = await client.rpc('increment_blog_views', { post_slug: cleanSlug });
            if (!error) rpcSuccess = true;
          } catch (rpcErr) {
            console.warn('Client RPC hatası, REST deneniyor...', rpcErr);
          }
        }

        // Yöntem B: REST API Fallback ile RPC çağrısı
        if (!rpcSuccess) {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/increment_blog_views`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ post_slug: cleanSlug })
          });
          if (res.ok) {
            rpcSuccess = true;
          }
        }

        return { success: rpcSuccess, incremented: rpcSuccess };
      } catch (err) {
        console.error('incrementViewCount çalıştırma hatası:', err);
        return { success: false, incremented: false, reason: err.message };
      } finally {
        activeViewLocks.delete(cleanSlug);
      }
    })();

    activeViewLocks.set(cleanSlug, executeIncrement);
    return await executeIncrement;
  },

  /**
   * Blog Analitiği ve İstatistik Verilerini Hesaplar
   * Tamamen gerçek veritabanı okumalarına dayanır, fake baseline İÇERMEZ.
   * @returns {Promise<Object>}
   */
  async getBlogStats() {
    const posts = await this.getPosts({ limit: 100 });
    const totalPosts = posts.length;
    let totalViews = 0;
    const categoryCounts = {};
    const categoryViews = {};

    posts.forEach(p => {
      const v = typeof p.views === 'number' && !isNaN(p.views) ? p.views : 0;
      totalViews += v;
      const cat = p.category || 'general';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      categoryViews[cat] = (categoryViews[cat] || 0) + v;
    });

    const sortedByViews = [...posts].sort((a, b) => (b.views || 0) - (a.views || 0));
    const mostViewedPost = sortedByViews[0] || null;

    let topCategory = 'custom';
    let topCatViews = 0;
    for (const [cat, views] of Object.entries(categoryViews)) {
      if (views >= topCatViews) {
        topCatViews = views;
        topCategory = cat;
      }
    }

    return {
      totalPosts,
      totalViews,
      mostViewedPost,
      topCategory: totalPosts > 0 ? topCategory : '-',
      topCategoryViews: totalPosts > 0 ? topCatViews : 0,
      posts: sortedByViews,
      categoryStats: categoryViews,
      categoryCounts
    };
  },

  /**
   * Yeni bir blog yazısı ekler (Admin paneli için)
   * view_count daima 0 olarak başlatılır.
   * @param {Object} postData
   * @returns {Promise<Object>}
   */
  async createPost(postData) {
    if (!postData || !postData.title || !postData.slug || !postData.content) {
      throw new Error('Başlık, slug ve içerik alanları zorunludur.');
    }

    const cleanSlug = postData.slug.trim().toLowerCase();
    
    // Slug benzersizlik kontrolü
    const isAvailable = await this.isSlugAvailable(cleanSlug);
    if (!isAvailable) {
      throw new Error(`"${cleanSlug}" adresi (slug) zaten başka bir yazıda kullanılıyor. Lütfen benzersiz bir slug belirleyin.`);
    }

    const client = getSupabaseClient();
    const payload = {
      title: postData.title.trim(),
      slug: cleanSlug,
      summary: postData.summary ? postData.summary.trim() : '',
      content: sanitizeHtml(postData.content),
      category: postData.category || 'general',
      image_url: postData.image_url ? postData.image_url.trim() : '',
      read_time: postData.read_time || '3 dk okuma',
      views: 0 // Yeni yazılar daima 0 görüntülenme ile başlar (fake değer yok)
    };

    if (postData.created_at) {
      payload.created_at = new Date(postData.created_at).toISOString();
    }

    if (client) {
      const { data, error } = await client.from('blogs').insert([payload]).select();
      if (error) throw error;
      return (data && data[0]) ? normalizePost(data[0]) : payload;
    }

    // REST Fallback
    const res = await fetch(`${SUPABASE_URL}/rest/v1/blogs`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error('Veritabanına eklenemedi: ' + errText);
    }
    const result = await res.json();
    return Array.isArray(result) && result[0] ? normalizePost(result[0]) : payload;
  },

  /**
   * Var olan bir blog yazısını kısmi (partial) olarak günceller
   * Veri kaybını önler, sadece verilen alanları günceller.
   * Mevcut views sayacına kesinlikle dokunmaz.
   * @param {string|number} id
   * @param {Object} postData
   * @returns {Promise<Object>}
   */
  async updatePost(id, postData) {
    if (!id) throw new Error('Güncellenecek yazının ID değeri belirtilmedi.');
    if (!postData || typeof postData !== 'object') throw new Error('Geçersiz güncelleme verisi.');

    // Eğer slug değiştiyse, başka bir yazıyla çakışmadığını kontrol et
    if (postData.slug) {
      const cleanSlug = postData.slug.trim().toLowerCase();
      const isAvailable = await this.isSlugAvailable(cleanSlug, id);
      if (!isAvailable) {
        throw new Error(`"${cleanSlug}" adresi (slug) zaten başka bir yazıda kullanılıyor. Lütfen benzersiz bir slug belirleyin.`);
      }
    }

    const client = getSupabaseClient();
    const payload = {};

    if (postData.title !== undefined) payload.title = postData.title.trim();
    if (postData.slug !== undefined) payload.slug = postData.slug.trim().toLowerCase();
    if (postData.summary !== undefined) payload.summary = postData.summary.trim();
    if (postData.content !== undefined) payload.content = sanitizeHtml(postData.content);
    if (postData.category !== undefined) payload.category = postData.category;
    if (postData.image_url !== undefined) payload.image_url = postData.image_url.trim();
    if (postData.read_time !== undefined) payload.read_time = postData.read_time;
    if (postData.created_at !== undefined && postData.created_at) {
      payload.created_at = new Date(postData.created_at).toISOString();
    }

    // views alanı update'te gönderilmez; gerçek okunma sayısı korunur

    if (client) {
      const { data, error } = await client.from('blogs').update(payload).eq('id', id).select();
      if (error) throw error;
      return (data && data[0]) ? normalizePost(data[0]) : payload;
    }

    // REST Fallback
    const res = await fetch(`${SUPABASE_URL}/rest/v1/blogs?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error('Güncelleme başarısız: ' + errText);
    }
    const result = await res.json();
    return Array.isArray(result) && result[0] ? normalizePost(result[0]) : payload;
  },

  /**
   * ID'ye göre blog yazısını siler
   * @param {string|number} id 
   * @returns {Promise<boolean>}
   */
  async deletePost(id) {
    if (!id) throw new Error('Silinecek yazı ID belirtilmedi.');
    const client = getSupabaseClient();

    if (client) {
      const { error } = await client.from('blogs').delete().eq('id', id);
      if (error) throw error;
      return true;
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/blogs?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error('Silme işlemi başarısız: ' + errText);
    }
    return true;
  }
};

if (typeof window !== 'undefined') {
  window.BlogService = BlogService;
  window.sanitizeHtml = sanitizeHtml;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BlogService, sanitizeHtml, isAutomatedBot, normalizePost };
}
