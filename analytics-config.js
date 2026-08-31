// Leave blank to disable. When you create a GA4 property, paste the
// Measurement ID here (format: G-XXXXXXXXXX) and redeploy — no other
// file needs to change.
const GA_MEASUREMENT_ID = "";

if (GA_MEASUREMENT_ID) {
  const s1 = document.createElement('script');
  s1.async = true;
  s1.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(s1);

  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID);
}
