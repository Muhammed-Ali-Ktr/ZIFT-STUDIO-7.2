-- ==============================================================================
-- ZIFT STUDIO — SUPABASE VERİTABANI ŞEMASI VE GÜVENLİK (RLS) POLİTİKALARI
-- ==============================================================================
-- Bu dosyadaki tüm kodları kopyalayıp:
-- Supabase Dashboard -> Sol Menüden "SQL Editor" -> "New Query" diyerek yapıştırın
-- ve yeşil "Run" butonuna basarak tek seferde çalıştırın.
-- ==============================================================================

-- 1. 'blogs' Tablosunun Oluşturulması
CREATE TABLE IF NOT EXISTS public.blogs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    summary TEXT,
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    image_url TEXT,
    read_time TEXT DEFAULT '3 dk okuma',
    views INTEGER DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tablo zaten mevcutsa 'views' kolonunun var olduğundan emin ol (Görüntülenme Sayacı)
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS views INTEGER DEFAULT 0 NOT NULL;

-- 2. Hızlı Filtreleme ve Arama İndeksleri
CREATE INDEX IF NOT EXISTS blogs_slug_idx ON public.blogs (slug);
CREATE INDEX IF NOT EXISTS blogs_category_idx ON public.blogs (category);
CREATE INDEX IF NOT EXISTS blogs_created_at_idx ON public.blogs (created_at DESC);
CREATE INDEX IF NOT EXISTS blogs_views_idx ON public.blogs (views DESC);

-- ==============================================================================
-- 2.1. 'blog_views' Tablosu (Opsiyonel & Gelişmiş Tekil Ziyaretçi / Log Takibi)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.blog_views (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    blog_id UUID REFERENCES public.blogs(id) ON DELETE CASCADE,
    post_slug TEXT NOT NULL,
    session_id TEXT,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS blog_views_post_slug_idx ON public.blog_views (post_slug);
CREATE INDEX IF NOT EXISTS blog_views_created_at_idx ON public.blog_views (created_at DESC);

ALTER TABLE public.blog_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public Read Blog Views" ON public.blog_views;
CREATE POLICY "Public Read Blog Views" 
ON public.blog_views 
FOR SELECT 
TO public 
USING (true);

DROP POLICY IF EXISTS "Public Insert Blog Views" ON public.blog_views;
CREATE POLICY "Public Insert Blog Views" 
ON public.blog_views 
FOR INSERT 
TO public 
WITH CHECK (true);

-- 3. Görüntülenme Sayacını Atomik Olarak Artıran Fonksiyon (RPC)
CREATE OR REPLACE FUNCTION increment_blog_views(post_slug TEXT, visitor_session TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. blogs tablosundaki sayacı atomik olarak artır
  UPDATE public.blogs
  SET views = COALESCE(views, 0) + 1
  WHERE slug = post_slug;

  -- 2. Eğer blog_views tablosu varsa detay logunu ekle
  BEGIN
    INSERT INTO public.blog_views (post_slug, session_id)
    VALUES (post_slug, visitor_session);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION increment_blog_views(TEXT, TEXT) TO anon, authenticated, public;
GRANT EXECUTE ON FUNCTION increment_blog_views(TEXT) TO anon, authenticated, public;

-- 4. Row Level Security (RLS) Güvenlik Katmanını Aç
ALTER TABLE public.blogs ENABLE ROW LEVEL SECURITY;

-- 5. Okuma İzni (Tüm site ziyaretçileri ve botlar okuyabilir)
DROP POLICY IF EXISTS "Public Read Access" ON public.blogs;
CREATE POLICY "Public Read Access" 
ON public.blogs 
FOR SELECT 
TO public 
USING (true);

-- 6. Admin Paneli Yazma / Güncelleme / Silme İzinleri
DROP POLICY IF EXISTS "Anon Insert Access" ON public.blogs;
CREATE POLICY "Anon Insert Access" 
ON public.blogs 
FOR INSERT 
TO anon 
WITH CHECK (true);

DROP POLICY IF EXISTS "Anon Delete Access" ON public.blogs;
CREATE POLICY "Anon Delete Access" 
ON public.blogs 
FOR DELETE 
TO anon 
USING (true);

DROP POLICY IF EXISTS "Anon Update Access" ON public.blogs;
CREATE POLICY "Anon Update Access" 
ON public.blogs 
FOR UPDATE 
TO anon 
USING (true);

-- ==============================================================================
-- BLOG SAYFASINDAKİ TÜM YAZILAR (BAŞLANGIÇ VERİLERİ - SEED):
-- ==============================================================================

INSERT INTO public.blogs (title, slug, summary, content, category, image_url, read_time, created_at)
VALUES 
-- 1. Randevu Sistemi Vaka Analizi
(
  'Kuaförden Kliniğe: Telefon Trafiğini ve Kaosu Sıfırlayan Randevu Sistemini Nasıl İnşa Ettik?',
  'kuafor-randevu-sistemi-mimari',
  'Telefon trafiğini ve çakışan saatleri bitiren, 0.3 saniyede açılan akıllı takvim ve yönetim paneli vaka analizimiz.',
  'Bir kuaför salonunu, diş hekimi kliniğini ya da psikolojik danışmanlık merkezini ziyaret ettiğinizde en sık duyduğunuz ses telefon zili ve fısıltılı takvim arayışlarıdır: *"Salı saat 14:00 dolu muydu? Ahmet Bey''in seansı ne zamandı?"* Bu kaos hem müşteriyi yorar hem de işletme sahibinin enerjisini tüketir.

> "Yazılım geliştirirken ilk kuralımız şudur: Kullanıcı sisteme girdiğinde bir kılavuza ihtiyaç duyuyorsa, o tasarım başarısızdır. Randevu sistemimizi 7''den 70''e herkesin 3 tıkla randevu alabileceği sadelikte inşa ettik."

### 🎯 1. Problem: Çakışan Randevular ve Kaybolan Mesajlar
İşletmeler genellikle WhatsApp mesajları, Instagram DM''leri ve kağıt ajandalar arasında bölünmüş durumdaydı. Gece yarısı gelen bir randevu talebine geç dönüldüğünde müşteri başka bir işletmeye gidiyor; aynı saate iki randevu yazıldığında ise kapıda kriz çıkıyordu. Biz ZiftStudio olarak masaya oturduğumuzda amacımız basitti: **İşletmeyi 7/24 randevu kabul eden otonom bir yapıya kavuşturmak.**

### 🌸 2. İki Farklı Tasarım Dili: Soft vs Modern
Her sektörün ruhu farklıdır. Bir güzellik merkezi veya klinik pastel tonlarda, ferah ve sakin bir arayüz (**Soft Tasarım**) isterken; modern bir berber stüdyosu veya dövme atölyesi yüksek kontrastlı, dinamik bir çizgi (**Modern Tasarım**) talep ediyordu. Biz de iki ayrı tasarım varyantını tek bir güçlü çekirdek üzerinde kurguladık.

![Randevu Sistemi Takvim Ekranı](../assets/image/randevu/randevu-2.png)
*📅 1. Anlık Saat & Personel Seçimi*

![Randevu Yönetim Paneli](../assets/image/randevu/randevu-4.png)
*⚙️ 2. Kolay Yönetim Paneli Arayüzü*

### ⚡ 3. Teknik Mimari: Neden Süper Hafif ve Hızlı?
Geleneksel randevu yazılımlarının çoğu ağır framework''ler ve yüzlerce gereksiz modülle şişirilmiştir. Müşteri randevu alırken sayfa donarsa sistemi terk eder. Biz sistemin ön yüzünü saf, optimize edilmiş modern JavaScript ile inşa ettik. Sayfa ilk açılışta yalnızca **0.3 saniyede** etkileşime hazır hale geliyor.

#### 💡 İşletme Sahibi İçin Ne Değişti?
- **Yazılımcıya Bağımlılık Sıfırlandı:** Fiyat, hizmet süresi, tatil günleri ve çalışma saatleri tek tıkla güncelleniyor.
- **Çift Rezervasyon İmkansız Hale Geldi:** Seçilen saat dilimi anında kilitlenerek çakışmalar matematiksel olarak engellendi.
- **Haftalık 15+ Saat Zaman Tasarrufu:** Telefonla randevu ayarlama yükü kalktı, işletme asıl işine odaklandı.',
  'custom',
  '../assets/image/randevu/randevu-1.png',
  '5 dk okuma',
  '2025-05-18T10:00:00Z'
),

-- 2. QR Menü Sistemleri
(
  'PDF Menülerin Sonu: Restoranlar İçin 0.2 Saniyede Açılan Temassız Menü Mimarisi',
  'pdf-menulerin-sonu-qr-menu-mimarisi',
  'Hantal PDF''ler yerine masada sipariş dönüşümünü %25 artıran admin panelli ve statik QR menü mimarimiz.',
  'Restorana oturup masadaki QR kodu okuttuğunuzda, telefonunuza 45 MB boyutunda, parmakla yakınlaştırılmaya çalışılan bozuk bir PDF dosyasının indiği o can sıkıcı anı hepimiz yaşadık. Menü açılana kadar sipariş verme hevesi kayboluyor.

> "Bir restoranda menü açılış süresi 2 saniyenin üzerine çıktığında, müşterinin memnuniyet puanı %40 düşer. Biz ZiftStudio''da menüyü 0.2 saniyede açılan bir web uygulaması haline getirdik."

### 🍔 1. Statik vs Admin Panelli: İki İhtiyaca İki Çözüm
Piyasadaki birçok yazılım firması tek bir hazır şablonu tüm kafelere zorla satmaya çalışır. Biz ise restoran sahiplerinin operasyonel gerçeğini ikiye ayırdık:

- **Admin Panelli Model:** Sürekli fiyat güncelleyen, yeni kahve/tatlı çeşitleri ekleyen veya günün menüsünü yayınlayan mekanlar için cep telefonundan 3 saniyede anında güncelleme imkanı.
- **Statik Model (Ekonomik & Ultra Hızlı):** Menüsü sabit olan veya fiyatları mevsimlik değişen işletmeler için sıfır sunucu riski, sıfır veritabanı yavaşlığı ve bütçe dostu maliyet.

![QR Menü Ürün Kartları](../assets/image/qrmenu1.png)
*🍽️ 1. İştah Açıcı Ürün Kartları & Fiyatlar*

![CafeAroma Dijital Menü](../assets/image/cafearoma-thumb.jpg)
*☕ 2. Kategori Butonları & Akıcı Filtreleme*

### 📈 2. Masada Sepet Tutarını Nasıl %25 Artırdık?
İyi çekilmiş ürün fotoğrafları, net alerjen uyarıları ve "Yanında iyi gider" önerileriyle zenginleştirilen dijital menülerimiz sayesinde müşteriler sipariş vermekten keyif alıyor. Garson çağırma ihtiyacı azalırken, masaların devir hızı (table turnover) %18 oranında hızlandı.

#### 💡 Neden Sıfır Güvenlik Riski?
Statik QR menülerimizde arka planda hacklenebilecek bir veritabanı veya açık sunucu portu bulunmaz. Tüm içerik küresel CDN altyapısında statik olarak önbelleğe alınır. Elektrikler kesilse bile siteniz asla çökmez!',
  'custom',
  '../assets/image/qr-menu-thumb.jpg',
  '4 dk okuma',
  '2025-05-02T10:00:00Z'
),

-- 3. Mikro-SaaS Projeleri
(
  'Küçük Araçlar, Büyük Etkiler: 4 Mikro-SaaS Projesini Geliştirirken Neler Öğrendik?',
  'kucuk-araclar-buyuk-etkiler-4-mikro-saas',
  'CafeAroma, Sınav Sayacı, QR Engine ve Flip Clock araçlarını geliştirirken elde ettiğimiz pratik mühendislik içgörüleri.',
  'Bir yazılımın değerli olması için milyon dolarlık bütçelere veya yüzlerce sayfalık karmaşık panellere ihtiyacı yoktur. Bazen tek bir amaca kusursuz hizmet eden mikro araçlar, kullanıcıların hayatını çok daha fazla kolaylaştırır.

> "ZiftStudio SaaS laboratuvarında geliştirdiğimiz ürünlerin tek bir ortak noktası var: Sıfır gecikme, tarayıcı tabanlı yüksek performans ve şık Neo-Brutalist estetik."

### ☕ 1. CafeAroma — Kafe Atmosferinin Dijital Yansıması
Kahve kokusunu dijitale taşımak kolay değil. CafeAroma ile müşterilere sadece bir menü değil; mekanın ruhunu hissettiren, rezervasyon akışını kolaylaştıran ve içecek profillerini tanıtan zarif bir marka sitesi sunduk.

### ⏳ 2. Sınav Sayacı — YKS & LGS Öğrencileri İçin Odaklanma Aracı
Sınava hazırlanan öğrencilerin en büyük ihtiyacı, ekran başında dikkat dağıtıcı unsurlardan arınmış net bir hedef bilincidir. Sınav Sayacı ile LocalStorage tabanlı, internet bağlantısı gerektirmeyen, hedef sınav tarihlerini anlık milisaniyesine kadar hesaplayan minimal bir sayaç inşa ettik.

![CafeAroma Ekranı](../assets/image/cafearoma-thumb.jpg)
*☕ CafeAroma Kafe Arayüzü*

![Sınav Sayacı Ekranı](../assets/image/sinavsayac-thumb.jpg)
*⏳ Sınav Sayacı Geri Sayım*

![QR Kod Oluşturucu Ekranı](../assets/image/qrcodegen-thumb.jpg)
*📲 QR Kod Jeneratörü*

![Flip Clock Ekranı](../assets/image/flipclock-thumb.jpg)
*⏰ 3D Flip Clock Dijital Saat*

### 📲 3. QR Kod Oluşturucu & ⏰ Flip Clock
**QR Kod Jeneratörümüzde** sunucuya hiçbir veri göndermeden doğrudan tarayıcı içi Canvas API üzerinden yüksek çözünürlüklü SVG/PNG QR kodları render ettik. **Flip Clock** projemizde ise CSS 3D Transforms ve perspektif animasyonlarıyla eski mekanik havaalanı saatlerinin o nostaljik akışını modern ekranlara taşıdık.

#### 💡 Mühendislik Çıkarımımız
Mikro-SaaS araçlarında en kritik unsur "Time to Value" süresidir. Kullanıcı sayfaya girdiği anda kayıt formuyla boğuşmadan, 2 saniye içinde aracın faydasını görmelidir. Bu prensip ürünlerimizin etkileşim oranını 3 katına çıkardı.',
  'saas',
  '../assets/image/saas-thumb.jpg',
  '6 dk okuma',
  '2025-04-20T10:00:00Z'
),

-- 4. Topluluk ve Kamu Projeleri
(
  'Sivil Toplumu Dijitale Taşımak: Gençlik Meclisleri İçin Katılım Platformu Mimarisi',
  'sivil-toplumu-dijitale-tasimak-genclik-meclisleri',
  'Konya Gençlik Parlamentosu ve Karatay Gençlik Meclisi projelerinde geleneksel kamu sitelerinin sıkıcı kalıplarını kırdık: Hızlı, modern, etkileşimli katılım platformu.',
  'Geleneksel kamu ve sivil toplum siteleri genellikle sıkıcı, bürokratik metinlerle dolu ve mobil cihazlarda kullanımı zor platformlardır. Konya Gençlik Parlamentosu ve Karatay Gençlik Meclisi projelerinde amacımız bu kalıbı tamamen kırmaktı.

> "Gençlerin bir platformu benimsemesi için arayüzün onların konuştuğu dilden anlaması gerekir: Hızlı, modern, etkileşimli ve şeffaf."

### 🏛️ 1. KonParlamento.org: Yurttaş Katılımında Yeni Bir Sayfa
KonParlamento platformu; gençlerin şehirle ilgili fikirlerini iletebildiği, komisyon çalışmalarını takip edebildiği ve anketlere katılabildiği şeffaf bir dijital köprü olarak kurgulandı. Ağır sunucu yüklerine dayanıklı, mobil öncelikli bir arayüz inşa ettik.

![KonParlamento Web Sitesi](../assets/image/proj-konparlamento.jpg)
*🏛️ KonParlamento.org Katılım Portalı*

![Karatay Gençlik Meclisi Platformu](../assets/image/proj-karataygenc.jpg)
*🎯 KaratayGençMeclis.org Gençlik Ağı*

### 🎯 2. KaratayGençMeclis.org: Etkinlikler ve Gençlik Dayanışması
Karatay Gençlik Meclisi projesinde ise gençlerin etkinliklere kayıt olabileceği, gönüllülük projelerine başvurabileceği ve meclis kararlarını inceleyebileceği interaktif modüller geliştirdik. Yüksek erişilebilirlik (A11y) standartlarına sadık kalarak her gencin platformdan eşit şekilde faydalanmasını sağladık.

#### 💡 Topluluk Projelerinde Öğrendiklerimiz
Sivil toplum projelerinde hız kadar **erişilebilirlik ve sade navigasyon** kritiktir. Ziyaretçilerin aradıkları duyuruya 2 saniye içinde ulaşabilmesi, etkinlik katılım oranlarını %60 artırdı.',
  'community',
  '../assets/image/proj-konparlamento.jpg',
  '4 dk okuma',
  '2025-03-25T10:00:00Z'
),

-- 5. Müşteri Siteleri & Kurumsal Dönüşüm
(
  'Portföyden 3D Baskı Kataloğuna: Yüksek Dönüşüm Getiren Müşteri Web Siteleri',
  'portfoyden-3d-baski-kataloguna-musteri-web-siteleri',
  'EmirHanTazegul.site kişisel markasından hukuk bürosuna ve 3D STL e-ticaret kataloğuna uzanan dijital dönüşüm ve yüksek dönüşüm mimarisi.',
  'Bir web sitesi kurmak sadece şık butonlar yerleştirmekten ibaret değildir. Asıl marifet; ziyaretçiyi kapıdan girdiği andan itibaren yönlendirip onunla güven bağı kurmak ve onu müşteriye dönüştürmektir.

> "ZiftStudio''da her müşteri projesini bir dijital satış temsilcisi gibi kurgularız: 7/24 uyanık, son derece nazik, ışık hızında ve güven veren bir temsilci."

### ✨ 1. EmirHanTazegul.site: Kişisel Markalaşmada Neo-Brutalist Dokunuş
Kişisel marka sitelerinde standart CV formatları artık dikkat çekmiyor. EmirHanTazegul.site projesinde yüksek enerjili Neo-Brutalist renk blokları, akıcı kaydırma animasyonları ve doğrudan iletişim aksiyonlarıyla kişisel uzmanlığı en üst seviyede konumlandırdık.

### ⚖️ 2. Hukuk Bürosu & 🖨️ 3D STL E-Ticaret Kataloğu
**Hukuk bürosu** platformunda güvenilirlik, gizlilik ve doğrudan EmailJS destekli danışmanlık talep formu odaklı sade bir kurumsal mimari tercih ettik. **3D STL & Printing Solutions** projesinde ise binlerce 3D model dosyasının hızlı filtrelenebildiği, filament/reçine sepet yönetimini ve WhatsApp sipariş akışını bir araya getirdik.

![Emirhan Tazegül Portföy](../assets/image/proj-emirhantazegul.jpg)
*🌟 Emirhan Tazegül Kişisel Marka*

![Hukuk Bürosu Web Sitesi](../assets/image/musteri-thumb.jpg)
*⚖️ Hukuk Bürosu Kurumsal Danışmanlık*

#### 💡 WhatsApp API Entegrasyonunun Gücü
Özellikle yerel e-ticaret ve hizmet işletmelerinde karmaşık ödeme adımları yerine **"WhatsApp ile Tek Tıkla Sipariş Ver"** butonunu entegre ettiğimizde, sipariş tamamlama oranlarında %45 artış gözlemledik. İnsanlar doğrudan iletişim kurmayı seviyor.',
  'community',
  '../assets/image/proj-emirhantazegul.jpg',
  '5 dk okuma',
  '2025-02-14T10:00:00Z'
),

-- 6. Mimari ve Kod Felsefesi
(
  'Neden ''Hazır Şablon'' Kullanmıyoruz? El Emeği Kod, TypeScript ve Neo-Brutalist Felsefemiz',
  'neden-hazir-sablon-kullanmiyoruz-muhendislik-felsefesi',
  'İnternet dünyası açılması 5 saniye süren hazır WordPress şablonlarıyla dolu. Biz ZiftStudio''da el emeği saf kod, strict TypeScript ve sıfır şişkinlik ile dijital başyapıtlar üretiyoruz.',
  'İnternet dünyası birbirinin aynı görünen, binlerce satır gereksiz CSS ve JavaScript eklentisiyle boğulmuş, açılması 5 saniye süren hazır WordPress şablonlarıyla dolu. Biz ZiftStudio''yu kurarken ilk kararımız bu fabrikasyon anlayışı reddetmek oldu.

> "Bir web sitesine baktığınızda onun bir insan tarafından özenle kodlandığını hissetmelisiniz. Piksel piksel işlenmiş tipografi, tok gölgeler ve saf performans bu zanaatın imzasıdır."

### 🧱 1. Neo-Brutalist Tasarım: Cesur, Dürüst ve Zamansız
Neo-Brutalism bizim için sadece görsel bir stil değil; internetin ilk günlerindeki dürüstlüğü modern estetikle buluşturma biçimidir. Kalın siyah çerçeveler, belirgin gölgeler, yüksek kontrastlı renkler ve göz alıcı mikro etkileşimler ziyaretçide anında unutulmaz bir etki bırakır.

### 🛡️ 2. Strict TypeScript & Sıfır Runtime Hatası
Projelerimizde `strict: true` moduyla tip güvenliği sağlıyoruz. Bu sayede hata payını daha derleme aşamasında sıfıra indiriyoruz. Kullanıcı hiçbir zaman beklenmedik bir beyaz ekranla karşılaşmaz.

#### 🏆 Lighthouse %98+ Performans Sözümüz
- **First Contentful Paint (FCP):** 0.4 saniyenin altında.
- **Cumulative Layout Shift (CLS):** 0 (Sıfır kayma, stabil düzen).
- **Mobil SEO Uyumluluğu:** %100 tam puan.
- **Sıfır Şişkinlik (Zero Bloat):** İhtiyaç duyulmayan hiçbir kütüphane projeye dahil edilmez.

Sonuç olarak; müşterilerimize sadece bir web sitesi değil, Google''da üst sıralara tırmanan, ziyaretçileri büyüleyen ve yıllarca sorunsuz çalışan dijital başyapıtlar teslim ediyoruz.',
  'engineering',
  '../assets/logos/ziftstudio/ziftstudio-logo-1.png',
  '6 dk okuma',
  '2025-01-10T10:00:00Z'
),

-- 7. KonParlamento 2026 Admin Altyapısı
(
  'KonParlamento 2026: Gençlik Parlamenter Platformu ve Canlı Admin Altyapısını İnşa Ediyoruz',
  'konparlamento-2026-genclik-parlamentosu-admin-altyapisi',
  'Yüzlerce delegenin ve organizasyonun tüm operasyonel yükünü üstlenecek, QR yoklamadan galeri moderasyonuna kadar tam teşekküllü dijital parlamenter platform ve canlı Supabase admin altyapımız.',
  'Gençlik meclislerinde katılımcı yönetimi, anlık oylamalar ve etkinlik akışı genellikle manuel süreçlerle aksar. KonParlamento 2026 etkinliği için, yüzlerce delegenin ve organizasyonun tüm operasyonel yükünü üstlenecek, QR yoklamadan galeri moderasyonuna kadar tam teşekküllü dijital parlamenter platformunu şu anda inşa ediyoruz.

> "Sivil katılımı artırmanın yolu, bürokrasiyi dijitalleştirmek değil; katılımı gençlerin elinin altındaki interaktif bir deneyime dönüştürmektir."

### 📱 1. Çok Yönlü Katılımcı Deneyimi ve Modüller
Geliştirmekte olduğumuz platform; Ana Sayfa, Hakkımızda, Komisyonlar, Partiler, Etkinlik Programı, Galeri ve İletişim modülleriyle ziyaretçilere şeffaf bilgi sunacak. Ayrıca kullanıcı kayıt sistemi sayesinde gençler platforma dahil olabilecek, siteye görsel yükleyebilecek, bilmeceleri yanıtlayabilecek ve canlı oylamalara katılabilecek.

![Admin Panel Dashboard Özeti](../assets/image/proj-konparlamento-dashboard-preview.png)
*⚡ Real-time Supabase DB & İstatistikler*

![Görsel Moderasyonu ve Başvuru Yönetimi](../assets/image/proj-konparlamento-moderation.png)
*🖼️ Galeri Moderasyonu & Başvuru Onayı*

### ⚡ 2. Güçlü Admin Paneli Mimarisi ve Modüler Yönetim
Yöneticilerin tüm organizasyon akışını anlık kontrol edebilmesi için özel bir **Admin Panel** tasarlıyoruz. Supabase PostgreSQL altyapısına doğrudan bağlı olan bu panel üzerinden aşağıdaki dinamik süreçlerin yönetilmesi planlanıyor:

- **Başvurular & Yoklama:** Yeni başvuruların onayı ve QR kod tarama sistemi ile fiziksel oturum katılım takibi.
- **Kullanıcı & Rol Yönetimi:** Kullanıcı yetkilendirmeleri, Komisyonlar ve Siyasi Partiler modülünün dinamik yönetimi.
- **İçerik & Galeri Moderasyonu:** Kayıtlı kullanıcılar tarafından yüklenen fotoğrafların moderasyon panelinde onaylanıp/reddedilmesi ve site içi metinlerin anlık güncellenmesi.
- **İnteraktif Araçlar:** Bilmeceler, canlı oylama sonuçları, push bildirim gönderimi, site ayarları ve güvenlik loglarının takibi.

#### 💡 Mimari & Performans Hedefi
Supabase PostgreSQL veritabanı entegrasyonu sayesinde ~400ms yanıt süreleriyle kesintisiz canlı veri akışı hedefliyoruz. Geliştirmekte olduğumuz QR kodlu yoklama sistemi ile salon girişlerindeki bekleme süresini tamamen ortadan kaldıracağız.',
  'community',
  '../assets/image/proj-konparlamento-2026-dashboard.png',
  '5 dk okuma',
  '2026-09-01T10:00:00Z'
),

-- 8. İrfan Meclis 2026 Platformu
(
  'İrfan Meclis 2026: irfanmeclis.org Dijital Katılım ve Yönetim Platformu Mimarisi',
  'irfan-meclis-2026-irfanmeclis-org-dijital-katilim-platformu',
  'irfanmeclis.org projesi için, yüzlerce delegenin ve organizasyonun tüm operasyonel yükünü sıfırlayan; QR kodlu yoklamadan dinamik CMS yönetimine ve anlık istatistiklere kadar tam teşekküllü dijital platform mimarimiz.',
  'Gençlik meclislerinde katılımcı yönetimi, anlık oylamalar ve etkinlik akışı genellikle manuel süreçlerle aksar. **irfanmeclis.org** projesi için, yüzlerce delegenin ve organizasyonun tüm operasyonel yükünü sıfırlayan; QR kodlu yoklamadan dinamik CMS yönetimine ve anlık istatistiklere kadar tam teşekküllü bir dijital parlamenter platform inşa ettik.

> "Sivil katılımı artırmanın yolu, bürokrasiyi dijitalleştirmek değil; katılımı gençlerin elinin altındaki interaktif bir deneyime dönüştürmektir."

### 📱 1. Ziyaretçi Deneyimi ve Modüler Arayüz
Önder Derneği öncülüğünde geliştirilen **irfanmeclis.org**; Ana Sayfa, Hakkımızda, Komisyonlar, Ekip, Program, Başvuru, Galeri ve İletişim modülleriyle ziyaretçilere şeffaf ve estetik bir deneyim sunuyor. Ana sayfada yer alan geri sayım sayacı, kurumsal tasarım dili ve "Fikirden Üreten Gençlik Meclisi" konseptiyle katılımcıları karşılıyor.

![Admin Panel Dashboard Özeti ve İstatistikler](../assets/image/irfan/proj-irfan-meclis-2026-dashboard-preview.png)
*⚡ Real-time Supabase DB & İstatistik Paneli*

![Görsel Moderasyonu ve Başvuru Yönetimi](../assets/image/irfan/proj-irfan-meclis-2026-moderation.png)
*🖼️ Medya Yönetimi & Başvuru Onay Mekanizması*

![QR Kodlu Yoklama ve Akreditasyon](../assets/image/irfan/proj-irfan-meclis-2026-attendance.png)
*📷 Canlı QR Tarayıcı & Gün Bazlı Takip*

![PDF Raporlama Sistemi](../assets/image/irfan/proj-irfan-meclis-2026-reports.png)
*📄 Resmi Katılım ve PDF Raporlama*

![Delege & Başvuru Yönetim Merkezi](../assets/image/irfan/proj-irfan-meclis-2026-delegates.png)
*👥 Kapsamlı Delege & Filtreleme Yönetimi*

### ⚡ 2. Güçlü Admin Paneli ve Modüler Yönetim Mimarisi
Yöneticilerin tüm organizasyon akışını anlık kontrol edebilmesi için özel bir **Yönetim Paneli** tasarlandı. Supabase PostgreSQL altyapısına doğrudan bağlı olan bu panel üzerinden yönetilen ana modüller şunlardır:

- **Sayfa Yönetimi (CMS):** Ana Sayfa, Hakkımızda, Komisyonlar, Ekip, Program ve Galeri sayfalarının dinamik metin/içerik güncellemesi.
- **Delege & Başvuru Yönetimi:** Başvuruların incelenmesi, onaylanması/reddedilmesi, e-posta şablonları gönderimi ve Excel formatında veri dışa aktarımı.
- **Medya Yönetimi (İki Kademeli):** Doğrudan yönetici yükleme alanı veya delege gönderilerinin incelenip onaylanarak galeriye kazandırılması.
- **QR Yoklama ve Akreditasyon:** Kamera ile canlı QR okuma, manuel barkod girişi ve mükerrer yoklamaları otomatik engelleyen akıllı akış.
- **Raporlama (PDF):** Yatay/dikey sayfa düzeni seçenekleriyle resmi katılım oranları ve gün bazlı detaylı PDF rapor çıktısı.

#### 💡 Mimari & Performans Hedefi
Supabase PostgreSQL veritabanı entegrasyonu ve optimize edilmiş mimari sayesinde milisaniyeler mertebesinde yanıt süreleriyle kesintisiz canlı veri akışı sağlandı. Geliştirilen QR kodlu yoklama sistemiyle salon girişlerindeki yığılmalar ve bekleme süreleri tamamen ortadan kaldırıldı.',
  'community',
  '../assets/image/irfan/proj-irfan-meclis-2026.png',
  '5 dk okuma',
  '2026-09-01T12:00:00Z'
)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  content = EXCLUDED.content,
  category = EXCLUDED.category,
  image_url = EXCLUDED.image_url,
  read_time = EXCLUDED.read_time,
  created_at = EXCLUDED.created_at;

-- ==============================================================================
-- 7. 'messages' Tablosu (Gelen Müşteri İletişim Formları & Yedekleme)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    project_type TEXT,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon Insert Messages" ON public.messages;
CREATE POLICY "Anon Insert Messages" 
ON public.messages 
FOR INSERT 
TO anon 
WITH CHECK (true);

DROP POLICY IF EXISTS "Anon Select Messages" ON public.messages;
CREATE POLICY "Anon Select Messages" 
ON public.messages 
FOR SELECT 
TO anon 
USING (true);
