import { useState, useCallback, useMemo } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const INDUSTRY_QUERIES = {
  "Alle Branchen": "Unternehmen Firma",
  "Handwerk": "Handwerker Handwerksbetrieb",
  "Bauunternehmen": "Bauunternehmen Baufirma",
  "Gastronomie": "Restaurant Gastronomie Café",
  "Einzelhandel": "Einzelhandel Geschäft Laden",
  "Logistik & Transport": "Logistik Spedition Transport",
  "IT & Software": "IT Software Unternehmen",
  "Gesundheitswesen": "Arztpraxis Gesundheitszentrum",
  "Immobilien": "Immobilienmakler Immobilien",
  "Maschinenbau": "Maschinenbau Fertigung",
  "Automobilbranche": "Autowerkstatt Autohandel KFZ",
  "Finanzdienstleistungen": "Steuerberater Finanzberatung",
  "Landwirtschaft": "Landwirtschaft Agrarbetrieb",
  "Energie": "Energieversorgung Solar Energie",
  "Beratung & Consulting": "Unternehmensberatung Consulting",
};

const REVENUE_RANGES = [
  { label: "Alle", min: 0, max: Infinity },
  { label: "< 1 Mio. €", min: 0, max: 1_000_000 },
  { label: "1 – 5 Mio. €", min: 1_000_000, max: 5_000_000 },
  { label: "2 – 10 Mio. €", min: 2_000_000, max: 10_000_000 },
  { label: "5 – 15 Mio. €", min: 5_000_000, max: 15_000_000 },
  { label: "10 – 50 Mio. €", min: 10_000_000, max: 50_000_000 },
  { label: "> 50 Mio. €", min: 50_000_000, max: Infinity },
];

const REVENUE_BENCHMARKS = {
  "Handwerk": { base: 800_000, range: [300_000, 3_000_000] },
  "Bauunternehmen": { base: 5_000_000, range: [1_000_000, 20_000_000] },
  "Gastronomie": { base: 600_000, range: [200_000, 2_500_000] },
  "Einzelhandel": { base: 1_200_000, range: [400_000, 8_000_000] },
  "Logistik & Transport": { base: 3_000_000, range: [500_000, 15_000_000] },
  "IT & Software": { base: 2_000_000, range: [300_000, 10_000_000] },
  "Gesundheitswesen": { base: 1_500_000, range: [500_000, 5_000_000] },
  "Immobilien": { base: 1_800_000, range: [300_000, 8_000_000] },
  "Maschinenbau": { base: 8_000_000, range: [2_000_000, 30_000_000] },
  "Automobilbranche": { base: 2_500_000, range: [500_000, 12_000_000] },
  "Finanzdienstleistungen": { base: 1_200_000, range: [300_000, 5_000_000] },
  "Landwirtschaft": { base: 1_000_000, range: [200_000, 5_000_000] },
  "Energie": { base: 5_000_000, range: [1_000_000, 25_000_000] },
  "Beratung & Consulting": { base: 1_500_000, range: [200_000, 8_000_000] },
  "Alle Branchen": { base: 2_000_000, range: [300_000, 10_000_000] },
};

function formatCurrency(val) {
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + " Mio. €";
  if (val >= 1_000) return (val / 1_000).toFixed(0) + " Tsd. €";
  return val + " €";
}

function estimateRevenue(company, industry) {
  const bench = REVENUE_BENCHMARKS[industry] || REVENUE_BENCHMARKS["Alle Branchen"];
  let estimate = bench.base;
  let confidence = "niedrig";
  const factors = [];
  if (company.rating >= 4.5 && company.reviewCount > 100) {
    estimate *= 1.4; factors.push("Hohe Bewertung + viele Reviews"); confidence = "mittel";
  } else if (company.rating >= 4.0 && company.reviewCount > 50) {
    estimate *= 1.2; factors.push("Gute Bewertung + solide Reviewanzahl");
  } else if (company.reviewCount < 10) {
    estimate *= 0.7; factors.push("Wenige Reviews deuten auf kleineres Unternehmen");
  }
  if (company.website) { estimate *= 1.15; factors.push("Webpräsenz vorhanden"); }
  else { estimate *= 0.85; factors.push("Keine Website gefunden"); }
  const majorCities = ["Hamburg","München","Berlin","Frankfurt","Köln","Düsseldorf","Stuttgart"];
  if (majorCities.some(c => (company.city || "").includes(c) || (company.address || "").includes(c))) {
    estimate *= 1.2; factors.push("Standort in Großstadt");
  }
  if (company.reviewCount > 500) { estimate *= 1.5; confidence = "mittel"; factors.push("Sehr hohe Kundenfrequenz"); }
  else if (company.reviewCount > 200) { estimate *= 1.25; factors.push("Hohe Kundenfrequenz"); }
  estimate = Math.round(estimate / 10_000) * 10_000;
  return { value: estimate, formatted: formatCurrency(estimate), source: "Geschätzt (Branchenbenchmark)", confidence, factors, range: bench.range };
}

// ─── GOOGLE PLACES API (NEW) ─────────────────────────────────────────────────

const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.types",
  "places.rating",
  "places.userRatingCount",
  "places.googleMapsUri",
  "places.addressComponents",
  "places.primaryTypeDisplayName",
  "places.shortFormattedAddress",
  "nextPageToken",
].join(",");

async function searchPlacesReal(apiKey, textQuery, maxResults, onProgress) {
  const allResults = [];
  let pageToken = null;
  let page = 0;

  while (allResults.length < maxResults) {
    page++;
    onProgress("Seite " + page + " wird geladen... (" + allResults.length + " Ergebnisse bisher)");

    const body = { textQuery, languageCode: "de", pageSize: 20 };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errMsg = errData?.error?.message || ("HTTP " + res.status);
      if (res.status === 403) throw new Error("API Zugriff verweigert (403). Bitte prüfen:\n1) Ist 'Places API (New)' aktiviert in der Cloud Console?\n2) Ist der API Schlüssel korrekt?\n3) Hat der Schlüssel Einschränkungen?\n\nGoogle meldet: " + errMsg);
      if (res.status === 400) throw new Error("Ungültige Anfrage (400): " + errMsg);
      if (res.status === 429) throw new Error("Zu viele Anfragen (429). Bitte kurz warten.");
      throw new Error("API Fehler " + res.status + ": " + errMsg);
    }

    const data = await res.json();

    if (!data.places || data.places.length === 0) {
      if (allResults.length === 0) throw new Error("Keine Unternehmen für '" + textQuery + "' gefunden. Versuchen Sie einen anderen Suchbegriff oder eine andere Stadt.");
      break;
    }

    for (const p of data.places) {
      if (allResults.length >= maxResults) break;
      let city = "";
      let postalCode = "";
      if (p.addressComponents) {
        for (const comp of p.addressComponents) {
          if (comp.types && comp.types.includes("locality")) city = comp.longText || "";
          if (comp.types && comp.types.includes("postal_code")) postalCode = comp.longText || "";
        }
      }
      allResults.push({
        id: p.id || ("place_" + allResults.length),
        name: p.displayName?.text || "Unbekannt",
        address: p.formattedAddress || p.shortFormattedAddress || "",
        phone: p.nationalPhoneNumber || "",
        website: p.websiteUri || "",
        category: p.primaryTypeDisplayName?.text || (p.types ? p.types[0] : ""),
        types: p.types || [],
        rating: p.rating || 0,
        reviewCount: p.userRatingCount || 0,
        mapsLink: p.googleMapsUri || "",
        city,
        postalCode,
        notes: "",
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
    await new Promise(r => setTimeout(r, 400));
  }

  return allResults;
}

// ─── CSV EXPORT ──────────────────────────────────────────────────────────────

function downloadCSV(data, filename) {
  const headers = ["Firmenname","Branche","Adresse","Stadt","PLZ","Telefonnummer","Website","Umsatz (geschätzt)","Umsatzquelle","Sicherheit","Google Bewertung","Bewertungen","Google Maps","Notizen"];
  const rows = data.map(c => [
    c.name, c.category, c.address, c.city, c.postalCode, c.phone, c.website,
    c.revenue?.formatted || "", c.revenue?.source || "", c.revenue?.confidence || "",
    c.rating, c.reviewCount, c.mapsLink, c.notes
  ]);
  const esc = v => '"' + String(v).replace(/"/g, '""') + '"';
  const csv = "\uFEFF" + [headers, ...rows].map(r => r.map(esc).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────

export default function App() {
  const [apiKey, setApiKey] = useState(localStorage.getItem("b2b_api_key") || "");
  const [city, setCity] = useState("Flensburg");
  const [maxResults, setMaxResults] = useState(60);
  const [industry, setIndustry] = useState("Alle Branchen");
  const [revenueRange, setRevenueRange] = useState(0);
  const [filterWebsite, setFilterWebsite] = useState(false);
  const [filterPhone, setFilterPhone] = useState(false);
  const [filterMinRating, setFilterMinRating] = useState(0);

  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [searchDone, setSearchDone] = useState(false);

  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [tableFilter, setTableFilter] = useState("");
  const [editingNote, setEditingNote] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [activeTab, setActiveTab] = useState("search");
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [tooltipId, setTooltipId] = useState(null);
  const [exportMsg, setExportMsg] = useState("");
  const PAGE_SIZE = 25;

  const saveApiKey = (val) => { setApiKey(val); try { localStorage.setItem("b2b_api_key", val); } catch(e) {} };

  // ─── SEARCH ────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    setError(""); setLoading(true); setSearchDone(false); setCurrentPage(1); setSelectedRows(new Set()); setProgress("Suche wird vorbereitet...");
    try {
      if (!apiKey.trim()) throw new Error("Bitte Google API Schlüssel eingeben.\n\nSo geht es:\n1) console.cloud.google.com öffnen\n2) Projekt erstellen\n3) 'Places API (New)' aktivieren\n4) API Schlüssel erstellen\n5) Hier einfügen");
      if (!city.trim()) throw new Error("Bitte Stadt oder Region eingeben.");

      const q = INDUSTRY_QUERIES[industry] + " in " + city.trim();
      setProgress("Suche: " + q);

      const raw = await searchPlacesReal(apiKey.trim(), q, maxResults, setProgress);
      setProgress("Umsatzschätzungen werden berechnet...");

      const withRev = raw.map(c => ({ ...c, revenue: estimateRevenue(c, industry) }));
      const rr = REVENUE_RANGES[revenueRange];
      const filtered = withRev.filter(c => {
        if (filterWebsite && !c.website) return false;
        if (filterPhone && !c.phone) return false;
        if (filterMinRating > 0 && c.rating < filterMinRating) return false;
        if (rr.max !== Infinity && c.revenue.value > rr.max) return false;
        if (c.revenue.value < rr.min) return false;
        return true;
      });

      setCompanies(filtered); setSearchDone(true); setProgress("");
      if (filtered.length > 0) setActiveTab("results");
      else if (withRev.length > 0) setError(withRev.length + " Unternehmen gefunden, aber alle durch Filter entfernt. Weniger strenge Filter verwenden.");
    } catch (err) { setError(err.message); setProgress(""); } finally { setLoading(false); }
  }, [apiKey, city, maxResults, industry, revenueRange, filterWebsite, filterPhone, filterMinRating]);

  // ─── TABLE ─────────────────────────────────────────────────────────────
  const processed = useMemo(() => {
    let d = [...companies];
    if (tableFilter) { const q = tableFilter.toLowerCase(); d = d.filter(c => c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || (c.category||"").toLowerCase().includes(q) || c.address.toLowerCase().includes(q) || (c.phone||"").includes(q)); }
    d.sort((a, b) => {
      let va, vb;
      if (sortKey === "revenue") { va = a.revenue?.value||0; vb = b.revenue?.value||0; }
      else if (sortKey === "confidence") { const o={niedrig:1,mittel:2,hoch:3}; va=o[a.revenue?.confidence]||0; vb=o[b.revenue?.confidence]||0; }
      else { va=a[sortKey]; vb=b[sortKey]; }
      if (typeof va==="number" && typeof vb==="number") return sortDir==="asc"?va-vb:vb-va;
      return sortDir==="asc"?String(va||"").localeCompare(String(vb||""),"de"):String(vb||"").localeCompare(String(va||""),"de");
    });
    return d;
  }, [companies, tableFilter, sortKey, sortDir]);

  const totalPages = Math.ceil(processed.length / PAGE_SIZE);
  const pageData = processed.slice((currentPage-1)*PAGE_SIZE, currentPage*PAGE_SIZE);
  const exportData = selectedRows.size > 0 ? processed.filter(c => selectedRows.has(c.id)) : processed;

  const handleSort = k => { if (sortKey===k) setSortDir(d=>d==="asc"?"desc":"asc"); else { setSortKey(k); setSortDir("asc"); } };
  const startEdit = (id,n) => { setEditingNote(id); setNoteText(n||""); };
  const saveN = id => { setCompanies(p=>p.map(c=>c.id===id?{...c,notes:noteText}:c)); setEditingNote(null); };
  const togRow = id => { setSelectedRows(p => { const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n; }); };
  const togAll = () => { const all=pageData.every(c=>selectedRows.has(c.id)); setSelectedRows(p => { const n=new Set(p); pageData.forEach(c=>all?n.delete(c.id):n.add(c.id)); return n; }); };

  const stats = useMemo(() => {
    if (!companies.length) return null;
    return { total:companies.length, avgRating:(companies.reduce((s,c)=>s+c.rating,0)/companies.length).toFixed(1), avgRevenue:formatCurrency(companies.reduce((s,c)=>s+(c.revenue?.value||0),0)/companies.length), wWeb:companies.filter(c=>c.website).length, wPh:companies.filter(c=>c.phone).length };
  }, [companies]);

  const handleExport = () => {
    const fn = "B2B_Leads_" + city.trim().replace(/\s+/g,"_") + "_" + new Date().toISOString().slice(0,10) + ".csv";
    downloadCSV(exportData, fn);
    setExportMsg("CSV mit " + exportData.length + " Einträgen exportiert!"); setTimeout(()=>setExportMsg(""),4000);
  };

  // ─── STYLES ────────────────────────────────────────────────────────────
  const crd = { background:"rgba(30,41,59,0.5)", borderRadius:"12px", border:"1px solid rgba(99,102,241,0.15)", padding:"20px" };
  const inp = { width:"100%", padding:"10px 14px", borderRadius:"8px", border:"1px solid rgba(99,102,241,0.3)", background:"rgba(15,23,42,0.8)", color:"#e2e8f0", fontSize:"14px", outline:"none", boxSizing:"border-box" };
  const sel = { ...inp, cursor:"pointer" };
  const lbl = { fontSize:"12px", fontWeight:600, color:"#94a3b8", marginBottom:"6px", display:"block", textTransform:"uppercase", letterSpacing:"0.5px" };
  const bP = { padding:"12px 28px", borderRadius:"8px", border:"none", background:"linear-gradient(135deg,#6366f1,#4f46e5)", color:"#fff", fontWeight:700, fontSize:"14px", cursor:"pointer" };
  const bS = { padding:"10px 20px", borderRadius:"8px", border:"1px solid rgba(99,102,241,0.3)", background:"rgba(99,102,241,0.1)", color:"#818cf8", fontWeight:600, fontSize:"13px", cursor:"pointer" };
  const thS = { padding:"10px 12px", fontSize:"11px", fontWeight:700, color:"#94a3b8", textTransform:"uppercase", letterSpacing:"0.5px", cursor:"pointer", whiteSpace:"nowrap", textAlign:"left", borderBottom:"1px solid rgba(99,102,241,0.15)", userSelect:"none", position:"sticky", top:0, background:"rgba(15,23,42,0.95)", zIndex:10 };
  const tdS = { padding:"10px 12px", fontSize:"13px", borderBottom:"1px solid rgba(30,41,59,0.8)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"200px" };
  const bdg = c => ({ display:"inline-block", padding:"2px 8px", borderRadius:"10px", fontSize:"11px", fontWeight:600, background:c+"20", color:c, border:"1px solid "+c+"40" });
  const chk = on => ({ width:"18px", height:"18px", borderRadius:"4px", cursor:"pointer", border:on?"none":"2px solid rgba(99,102,241,0.4)", background:on?"linear-gradient(135deg,#6366f1,#4f46e5)":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 });
  const Ck = () => <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>;
  const SA = ({col}) => sortKey!==col?<span style={{opacity:0.3,marginLeft:4}}>↕</span>:<span style={{color:"#818cf8",marginLeft:4}}>{sortDir==="asc"?"↑":"↓"}</span>;

  // ─── SEARCH TAB ────────────────────────────────────────────────────────
  const SearchTab = () => (
    <div style={{padding:"24px",maxWidth:"900px",margin:"0 auto"}}>
      <div style={{...crd,marginBottom:"16px"}}>
        <h3 style={{margin:"0 0 12px",fontSize:"15px",fontWeight:700,color:"#e2e8f0"}}>🔑 Google Places API Schlüssel</h3>
        <div style={lbl}>API Key (wird lokal gespeichert)</div>
        <input style={inp} type="password" value={apiKey} onChange={e=>saveApiKey(e.target.value)} placeholder="AIzaSy..." />
        <p style={{fontSize:"11px",color:"#64748b",marginTop:"8px",lineHeight:1.6}}>
          Google Cloud Console → Neues Projekt → "Places API (New)" aktivieren → Anmeldedaten → API Schlüssel erstellen. Detaillierte Anleitung im Tab "Anleitung".
        </p>
      </div>

      <div style={{...crd,marginBottom:"16px"}}>
        <h3 style={{margin:"0 0 16px",fontSize:"15px",fontWeight:700,color:"#e2e8f0"}}>🔍 Suchparameter</h3>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px"}}>
          <div><div style={lbl}>Stadt / Region</div><input style={inp} value={city} onChange={e=>setCity(e.target.value)} placeholder="z.B. Flensburg, Hamburg..." /></div>
          <div><div style={lbl}>Max. Ergebnisse</div><select style={sel} value={maxResults} onChange={e=>setMaxResults(+e.target.value)}>{[20,40,60,80,100,150,200].map(n=><option key={n} value={n}>{n}</option>)}</select></div>
          <div><div style={lbl}>Branche</div><select style={sel} value={industry} onChange={e=>setIndustry(e.target.value)}>{Object.keys(INDUSTRY_QUERIES).map(k=><option key={k} value={k}>{k}</option>)}</select></div>
          <div><div style={lbl}>Umsatzbereich (geschätzt)</div><select style={sel} value={revenueRange} onChange={e=>setRevenueRange(+e.target.value)}>{REVENUE_RANGES.map((r,i)=><option key={i} value={i}>{r.label}</option>)}</select></div>
        </div>
      </div>

      <div style={{...crd,marginBottom:"24px"}}>
        <h3 style={{margin:"0 0 16px",fontSize:"15px",fontWeight:700,color:"#e2e8f0"}}>🎯 Optionale Filter</h3>
        <div style={{display:"flex",flexWrap:"wrap",gap:"20px",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:"8px",cursor:"pointer"}} onClick={()=>setFilterWebsite(!filterWebsite)}><div style={chk(filterWebsite)}>{filterWebsite&&<Ck/>}</div><span style={{fontSize:"13px",color:"#cbd5e1"}}>Nur mit Website</span></div>
          <div style={{display:"flex",alignItems:"center",gap:"8px",cursor:"pointer"}} onClick={()=>setFilterPhone(!filterPhone)}><div style={chk(filterPhone)}>{filterPhone&&<Ck/>}</div><span style={{fontSize:"13px",color:"#cbd5e1"}}>Nur mit Telefon</span></div>
          <div style={{display:"flex",alignItems:"center",gap:"8px"}}><span style={{fontSize:"13px",color:"#cbd5e1"}}>Min. Bewertung:</span><select style={{...sel,width:"80px",padding:"6px 10px"}} value={filterMinRating} onChange={e=>setFilterMinRating(+e.target.value)}><option value={0}>Alle</option>{[3,3.5,4,4.5].map(r=><option key={r} value={r}>≥ {r}</option>)}</select></div>
        </div>
      </div>

      <div style={{textAlign:"center"}}>
        <button style={{...bP,padding:"14px 48px",fontSize:"15px",opacity:loading?0.7:1}} onClick={handleSearch} disabled={loading}>
          {loading ? "⏳ Suche läuft..." : "🔍 Unternehmen suchen"}
        </button>
        {loading && progress && <p style={{fontSize:"13px",color:"#818cf8",marginTop:"10px"}}>{progress}</p>}
      </div>

      {error && <div style={{marginTop:"16px",padding:"14px 18px",background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:"8px",color:"#fca5a5",fontSize:"13px",lineHeight:1.7,whiteSpace:"pre-wrap"}}>⚠ {error}</div>}

      <div style={{...crd,marginTop:"24px",borderLeft:"3px solid #f59e0b"}}>
        <h4 style={{margin:"0 0 8px",fontSize:"13px",fontWeight:700,color:"#f59e0b"}}>💡 Kostenhinweis</h4>
        <p style={{margin:0,fontSize:"12px",color:"#94a3b8",lineHeight:1.6}}>
          100 Unternehmen suchen = ca. 5 API Aufrufe = ca. 0,16 bis 0,35 USD je nach Feldern. Google bietet kostenlose Monatskontingente. Budgetlimit in der Cloud Console setzen.
        </p>
      </div>
    </div>
  );

  // ─── RESULTS TAB ───────────────────────────────────────────────────────
  const ResultsTab = () => (
    <div style={{padding:"24px"}}>
      {stats && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"12px",marginBottom:"20px"}}>
          {[{l:"Unternehmen",v:stats.total,c:"#6366f1"},{l:"Ø Bewertung",v:stats.avgRating+" ★",c:"#f59e0b"},{l:"Ø Umsatz",v:stats.avgRevenue,c:"#22c55e"},{l:"Mit Website",v:stats.wWeb+" ("+Math.round(stats.wWeb/stats.total*100)+"%)",c:"#3b82f6"},{l:"Mit Telefon",v:stats.wPh+" ("+Math.round(stats.wPh/stats.total*100)+"%)",c:"#ec4899"}].map(s=>(
            <div key={s.l} style={{...crd,borderLeft:"3px solid "+s.c}}><div style={{fontSize:"20px",fontWeight:800,color:s.c}}>{s.v}</div><div style={{fontSize:"11px",color:"#94a3b8",marginTop:"4px"}}>{s.l}</div></div>
          ))}
        </div>
      )}

      <div style={{display:"flex",gap:"12px",marginBottom:"16px",flexWrap:"wrap",alignItems:"center"}}>
        <input style={{...inp,maxWidth:"300px"}} placeholder="🔍 Filtern..." value={tableFilter} onChange={e=>{setTableFilter(e.target.value);setCurrentPage(1);}} />
        <div style={{flex:1}} />
        <span style={{fontSize:"12px",color:"#64748b"}}>{processed.length} Einträge{selectedRows.size>0?" · "+selectedRows.size+" ausgewählt":""}</span>
        {exportData.length>0 && <button style={bS} onClick={handleExport}>📥 CSV Export ({exportData.length})</button>}
      </div>

      {exportMsg && <div style={{marginBottom:"12px",padding:"10px 16px",background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.3)",borderRadius:"8px",color:"#6ee7b7",fontSize:"13px"}}>✓ {exportMsg}</div>}

      {pageData.length > 0 && (
        <div style={{...crd,padding:0,overflow:"hidden"}}>
          <div style={{overflowX:"auto",maxHeight:"calc(100vh - 380px)"}}>
            <table style={{width:"100%",borderCollapse:"collapse",minWidth:"1400px"}}>
              <thead><tr>
                <th style={{...thS,width:"40px"}}><div style={chk(pageData.length>0&&pageData.every(c=>selectedRows.has(c.id)))} onClick={togAll}>{pageData.every(c=>selectedRows.has(c.id))&&pageData.length>0&&<Ck/>}</div></th>
                {[["name","Firmenname"],["category","Branche"],["city","Stadt"],["phone","Telefon"],["website","Website"],["revenue","Umsatz"],["confidence","Sicherheit"],["rating","Bewertung"],["reviewCount","Reviews"],["notes","Notizen"]].map(([k,l])=>(
                  <th key={k} style={thS} onClick={()=>handleSort(k)}>{l}<SA col={k}/></th>
                ))}
                <th style={thS}>Maps</th>
              </tr></thead>
              <tbody>
                {pageData.map((c,i)=>(
                  <tr key={c.id} style={{background:selectedRows.has(c.id)?"rgba(99,102,241,0.1)":i%2===0?"transparent":"rgba(15,23,42,0.3)"}}>
                    <td style={tdS}><div style={chk(selectedRows.has(c.id))} onClick={()=>togRow(c.id)}>{selectedRows.has(c.id)&&<Ck/>}</div></td>
                    <td style={{...tdS,fontWeight:600,color:"#e2e8f0"}}>{c.name}</td>
                    <td style={tdS}><span style={bdg("#818cf8")}>{c.category}</span></td>
                    <td style={tdS}>{c.city||"—"}</td>
                    <td style={{...tdS,fontFamily:"monospace",fontSize:"12px"}}>{c.phone||<span style={{color:"#475569"}}>—</span>}</td>
                    <td style={tdS}>{c.website?<a href={c.website} target="_blank" rel="noopener noreferrer" style={{color:"#818cf8",textDecoration:"none",fontSize:"12px"}}>{c.website.replace(/^https?:\/\/(www\.)?/,"").slice(0,28)}</a>:<span style={{color:"#475569"}}>—</span>}</td>
                    <td style={{...tdS,fontWeight:600,color:"#6ee7b7"}}>{c.revenue?.formatted||"N/A"}</td>
                    <td style={tdS}>
                      <div style={{position:"relative",display:"inline-block"}} onMouseEnter={()=>setTooltipId(c.id)} onMouseLeave={()=>setTooltipId(null)}>
                        <span style={bdg(c.revenue?.confidence==="mittel"?"#22c55e":"#f59e0b")}>{c.revenue?.confidence}</span>
                        {tooltipId===c.id&&<div style={{position:"absolute",bottom:"100%",left:"50%",transform:"translateX(-50%)",background:"rgba(15,23,42,0.95)",border:"1px solid rgba(99,102,241,0.3)",borderRadius:"8px",padding:"10px 14px",fontSize:"12px",color:"#cbd5e1",whiteSpace:"pre-wrap",maxWidth:"280px",zIndex:50,boxShadow:"0 10px 30px rgba(0,0,0,0.5)",marginBottom:"8px"}}>
                          <div style={{fontWeight:700,marginBottom:6,color:"#818cf8"}}>Schätzungsgrundlage</div>
                          {(c.revenue?.factors||[]).map((f,j)=><div key={j} style={{marginBottom:3}}>• {f}</div>)}
                          <div style={{marginTop:8,fontSize:11,color:"#64748b"}}>Spanne: {formatCurrency(c.revenue.range[0])} – {formatCurrency(c.revenue.range[1])}</div>
                        </div>}
                      </div>
                    </td>
                    <td style={tdS}><span style={{color:"#f59e0b"}}>{"★".repeat(Math.round(c.rating))}</span> <span style={{color:"#64748b"}}>{c.rating.toFixed(1)}</span></td>
                    <td style={{...tdS,color:"#94a3b8"}}>{c.reviewCount}</td>
                    <td style={tdS}>
                      {editingNote===c.id?(
                        <div style={{display:"flex",gap:"4px"}}><input style={{...inp,width:"120px",padding:"4px 8px",fontSize:"12px"}} value={noteText} onChange={e=>setNoteText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveN(c.id);if(e.key==="Escape")setEditingNote(null);}} autoFocus /><button onClick={()=>saveN(c.id)} style={{...bS,padding:"4px 8px",fontSize:"11px"}}>✓</button></div>
                      ):(<span onClick={()=>startEdit(c.id,c.notes)} style={{cursor:"pointer",color:c.notes?"#cbd5e1":"#475569",fontSize:"12px"}}>{c.notes||"＋"}</span>)}
                    </td>
                    <td style={tdS}>{c.mapsLink?<a href={c.mapsLink} target="_blank" rel="noopener noreferrer" style={{color:"#818cf8",textDecoration:"none",fontSize:"18px"}}>📍</a>:"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages>1&&(
            <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:"6px",padding:"14px",borderTop:"1px solid rgba(99,102,241,0.1)"}}>
              <button style={{...bS,padding:"6px 12px"}} onClick={()=>setCurrentPage(1)} disabled={currentPage===1}>«</button>
              <button style={{...bS,padding:"6px 12px"}} onClick={()=>setCurrentPage(p=>Math.max(1,p-1))} disabled={currentPage===1}>‹</button>
              <span style={{fontSize:"13px",color:"#94a3b8",margin:"0 8px"}}>Seite {currentPage} von {totalPages}</span>
              <button style={{...bS,padding:"6px 12px"}} onClick={()=>setCurrentPage(p=>Math.min(totalPages,p+1))} disabled={currentPage===totalPages}>›</button>
              <button style={{...bS,padding:"6px 12px"}} onClick={()=>setCurrentPage(totalPages)} disabled={currentPage===totalPages}>»</button>
            </div>
          )}
        </div>
      )}
      {!companies.length&&searchDone&&<div style={{textAlign:"center",padding:"60px",color:"#64748b"}}><div style={{fontSize:"48px"}}>🔍</div><div style={{fontSize:"16px",fontWeight:600,marginTop:"16px"}}>Keine Ergebnisse</div></div>}
      {!searchDone&&!companies.length&&<div style={{textAlign:"center",padding:"60px",color:"#64748b"}}><div style={{fontSize:"48px"}}>📊</div><div style={{fontSize:"16px",fontWeight:600,marginTop:"16px"}}>Noch keine Suche durchgeführt</div><div style={{fontSize:"13px",marginTop:"8px"}}>API Schlüssel und Suchkriterien im Tab "Suche" eingeben.</div></div>}
    </div>
  );

  // ─── GUIDE TAB ─────────────────────────────────────────────────────────
  const GuideTab = () => (
    <div style={{padding:"24px",maxWidth:"800px",margin:"0 auto"}}>
      {[
        {t:"1. Google Cloud Projekt erstellen",i:"☁",c:"1) console.cloud.google.com öffnen\n2) Oben auf Projektauswahl klicken → 'Neues Projekt'\n3) Name: z.B. 'B2B LeadEngine' → 'Erstellen'"},
        {t:"2. Places API (New) aktivieren",i:"🔌",c:"1) Links: 'APIs & Dienste' → 'Bibliothek'\n2) Suchen: 'Places API (New)'\n3) WICHTIG: Die Version mit '(New)' wählen!\n4) 'Aktivieren' klicken\n\nDas ist die einzige API die Sie brauchen."},
        {t:"3. API Schlüssel erstellen",i:"🔑",c:"1) 'APIs & Dienste' → 'Anmeldedaten'\n2) '+ Anmeldedaten erstellen' → 'API Schlüssel'\n3) Schlüssel kopieren (beginnt mit AIza...)\n4) Im Tool unter 'Suche' einfügen\n\nEmpfehlung: 'Schlüssel einschränken' → nur 'Places API (New)'"},
        {t:"4. Abrechnung einrichten",i:"💳",c:"Google verlangt eine Abrechnungsmethode, aber:\n• Jeder SKU hat kostenlose Monatskontingente\n• Text Search Essentials: 5.000 Aufrufe/Monat frei\n• Text Search Pro: 5.000 Aufrufe/Monat frei\n\nBudgetlimit setzen: 'Abrechnung' → 'Budgets & Benachrichtigungen' → z.B. 10 EUR"},
        {t:"5. Was kostet eine Suche?",i:"💰",c:"Pro Text Search Aufruf (20 Ergebnisse):\n• Essentials Felder (Name, Adresse, Bewertung): ~0,032 USD\n• Pro Felder (Telefon, Website): ~0,035 USD\n\n100 Unternehmen = 5 Aufrufe = ca. 0,17 USD\n1.000 Unternehmen = 50 Aufrufe = ca. 1,75 USD"},
        {t:"6. Datenschutz",i:"🔒",c:"• Nur öffentliche Google Maps Geschäftsdaten\n• Keine personenbezogenen Daten\n• Offizielle Google API, kein Scraping\n• API Schlüssel wird nur lokal gespeichert"},
        {t:"7. Fehlerbehebung",i:"🔧",c:"'Load failed' / Netzwerkfehler:\n→ Kann in der Claude Vorschau nicht funktionieren\n→ App lokal starten (siehe Installation)\n\n403 Forbidden:\n→ 'Places API (New)' nicht aktiviert\n→ API Schlüssel Einschränkungen prüfen\n\n400 Bad Request:\n→ Suchbegriff ändern\n\nKeine Ergebnisse:\n→ Größere Stadt oder anderen Begriff versuchen"},
      ].map((s,i)=>(
        <div key={i} style={{...crd,marginBottom:"16px"}}>
          <h3 style={{margin:"0 0 10px",fontSize:"15px",fontWeight:700,color:"#e2e8f0"}}>{s.i} {s.t}</h3>
          <p style={{margin:0,fontSize:"13px",color:"#94a3b8",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{s.c}</p>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{fontFamily:"'DM Sans','Segoe UI',system-ui,sans-serif",background:"linear-gradient(145deg,#0a0e1a,#111827,#0f172a)",minHeight:"100vh",color:"#e2e8f0"}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{background:"linear-gradient(135deg,rgba(30,58,138,0.5),rgba(15,23,42,0.9))",borderBottom:"1px solid rgba(99,102,241,0.2)",padding:"20px 24px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <h1 style={{fontSize:"22px",fontWeight:700,letterSpacing:"-0.5px",background:"linear-gradient(135deg,#818cf8,#6ee7b7)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",margin:0}}>B2B LeadEngine</h1>
            <p style={{fontSize:"12px",color:"#94a3b8",marginTop:"4px",letterSpacing:"2px",textTransform:"uppercase"}}>Neukundenakquise mit Google Places API</p>
          </div>
          {stats&&<span style={{fontSize:"12px",color:"#6ee7b7",fontWeight:600}}>{stats.total} echte Unternehmen geladen</span>}
        </div>
      </div>
      <div style={{display:"flex",gap:"2px",padding:"0 24px",background:"rgba(15,23,42,0.5)"}}>
        {[{id:"search",l:"🔍 Suche"},{id:"results",l:"📊 Ergebnisse"+(companies.length?" ("+companies.length+")":"")},{id:"guide",l:"📖 Anleitung"}].map(t=>(
          <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{padding:"12px 20px",cursor:"pointer",fontSize:"13px",fontWeight:600,color:activeTab===t.id?"#818cf8":"#64748b",background:"transparent",border:"none",borderBottom:activeTab===t.id?"2px solid #818cf8":"2px solid transparent"}}>{t.l}</button>
        ))}
      </div>
      {activeTab==="search"&&<SearchTab/>}
      {activeTab==="results"&&<ResultsTab/>}
      {activeTab==="guide"&&<GuideTab/>}
    </div>
  );
}
