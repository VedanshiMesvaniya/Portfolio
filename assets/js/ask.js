/* =====================================================================
   "Ask this portfolio" chat
   - Every fact comes from the page itself (index.html), so there is one
     place to edit content.
   - Questions are answered locally in the browser: intent rules compose
     a short answer, and a BM25 search over the page is the fallback.
   - Optional: set data-endpoint on #ask to a small API (see worker/) and
     answers come from a language model reading the resume instead. If the
     endpoint is empty or fails, the local answers are used.
   ===================================================================== */
(function () {
  'use strict';

  var doc = document;
  var $ = function (s, c) { return (c || doc).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); };
  var norm = function (s) { return String(s).replace(/\s+/g, ' ').trim(); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var reduceMotion = function () { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var key = function (s) { return ' ' + String(s).toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim() + ' '; };
  var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  var esc = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  var unique = function (a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); };
  function joinList(a) {
    if (a.length <= 1) return a.join('');
    if (a.length === 2) return a[0] + ' and ' + a[1];
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }

  /* ------------------------------------------------------------------
     1. Read the facts from the page
     ------------------------------------------------------------------ */
  function readSite() {
    var t = function (el) { return el ? norm(el.textContent) : ''; };
    var aliasOf = function (el) { return (el.getAttribute('data-alias') || '').split('|').filter(Boolean); };

    var exp = $$('.tl').map(function (el) {
      return { id: el.id, name: el.getAttribute('data-source'), role: t($('h3', el)), org: t($('.tl__org', el)),
        date: t($('.tl__date', el)), brief: el.getAttribute('data-brief') || '', alias: aliasOf(el),
        bullets: $$('.tl__list li', el).map(t) };
    });
    var projects = $$('.proj').map(function (el) {
      return { id: el.id, name: el.getAttribute('data-name'), brief: el.getAttribute('data-brief') || '',
        alias: aliasOf(el).concat([el.getAttribute('data-name')]), tags: $$('.tags li', el).map(t),
        bullets: $$('.proj__list li', el).map(t) };
    });
    var skills = $$('.skill').map(function (el) {
      return { title: t($('h3', el)), items: $$('.chips li', el).map(t) };
    });
    var edu = $$('#education .pair__item').map(function (el) {
      return { id: el.id, degree: t($('h3', el)), org: t($('.pair__org', el)), date: t($('.pair__date', el)),
        meta: t($('.pair__meta', el)), alias: aliasOf(el) };
    });
    var certs = $$('#certifications .pair__item').map(function (el) {
      return { id: el.id, name: t($('h3', el)), date: t($('.pair__date', el)), org: t($('.pair__org', el)), alias: aliasOf(el) };
    });
    var cvLink = $('a[download]');
    var contact = { place: 'Rajkot, Gujarat, India', cv: cvLink ? cvLink.getAttribute('href') : '' };
    $$('#contact-list a').forEach(function (a) {
      var h = a.getAttribute('href') || '';
      if (h.indexOf('mailto:') === 0) contact.email = h.slice(7);
      else if (h.indexOf('tel:') === 0) { contact.phone = t(a); }
      else if (h.indexOf('linkedin') !== -1) { contact.linkedin = h; contact.linkedinText = t(a); }
      else if (h.indexOf('github') !== -1) { contact.github = h; contact.githubText = t(a); }
    });
    return { exp: exp, projects: projects, skills: skills, edu: edu, certs: certs, contact: contact };
  }

  /* ------------------------------------------------------------------
     2. Search engine (BM25) over the passages marked data-p
     ------------------------------------------------------------------ */
  var STOP = new Set(('a an the and or but of to in on for with at by from as is are was were be been being ' +
    'do does did you your yours i me my we our it its this that these those what which who whom how when where why ' +
    'can could would should will shall have has had having about tell any some more most very also into than then ' +
    'there their they them he she his her if so not no yes please give show list know like want handle handles ' +
    'handled handling vedanshi').split(' '));
  var IRREGULAR = { built: 'build', building: 'build', builds: 'build', used: 'use', using: 'use', uses: 'use',
    worked: 'work', working: 'work', works: 'work', wrote: 'write', written: 'write', studied: 'study', studies: 'study' };

  function stem(w) {
    if (IRREGULAR[w]) return IRREGULAR[w];
    if (w.length > 4 && w.slice(-3) === 'ies') return w.slice(0, -3) + 'y';
    if (w.length > 5 && w.slice(-3) === 'ing') return w.slice(0, -3);
    if (w.length > 4 && w.slice(-2) === 'ed') return w.slice(0, -2);
    if (w.length > 3 && w.slice(-1) === 's' && w.slice(-2) !== 'ss') return w.slice(0, -1);
    return w;
  }
  function words(text) { return String(text).toLowerCase().match(/[a-z0-9+#]+/g) || []; }

  function passageText(el) {
    if (el.classList.contains('skill')) {
      return norm($('h3', el).textContent) + ': ' + $$('.chips li', el).map(function (c) { return norm(c.textContent); }).join(', ') + '.';
    }
    if (el.classList.contains('pair__item')) {
      return $$('h3, .pair__org, .pair__meta', el).map(function (n) { return norm(n.textContent); }).join('. ') + '.';
    }
    return norm(el.textContent);
  }
  function keywords(el) {
    var out = [];
    for (var n = el; n && n !== doc.body; n = n.parentElement) {
      if (n.getAttribute && n.getAttribute('data-kw')) out.push(n.getAttribute('data-kw'));
    }
    return out.join(' ');
  }

  function makeDoc(text, source, kind, targetId, el, kw) {
    var d = { el: el || null, text: text, source: source, kind: kind, targetId: targetId || '', counts: Object.create(null), len: 0 };
    words([text, source, kind, kw || ''].join(' ')).forEach(function (w) {
      if (STOP.has(w)) return;
      var s = stem(w);
      d.counts[s] = (d.counts[s] || 0) + 1;
      d.len++;
    });
    return d;
  }
  function finalizeIndex(docs) {
    var df = Object.create(null), total = 0;
    docs.forEach(function (d) {
      total += d.len;
      Object.keys(d.counts).forEach(function (k) { df[k] = (df[k] || 0) + 1; });
    });
    return { docs: docs, df: df, avg: docs.length ? total / docs.length : 1 };
  }
  function buildIndex() {
    return finalizeIndex($$('[data-p]').map(function (el) {
      var ctx = el.closest('[data-source]');
      return makeDoc(passageText(el), ctx ? ctx.getAttribute('data-source') : 'Portfolio',
        ctx ? ctx.getAttribute('data-kind') : '', ctx ? ctx.id : '', el, keywords(el));
    }));
  }
  /* Extra documents from the knowledge folder (assets/data/knowledge.json). The resume is
     skipped because the page already contains it. */
  function loadKnowledge() {
    return fetch('assets/data/knowledge.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : { chunks: [] }; })
      .then(function (d) { return (d.chunks || []).filter(function (c) { return !/resume|\bcv\b/i.test(c.file); }); })
      .catch(function () { return []; });
  }

  function search(index, question, filter, limit) {
    var K1 = 1.3, B = 0.7, N = index.docs.length;
    var qs = unique(words(question).filter(function (w) { return !STOP.has(w); }).map(stem));
    var scored = index.docs.filter(function (d) { return !filter || filter(d); }).map(function (d) {
      var score = 0;
      qs.forEach(function (t) {
        var f = d.counts[t];
        if (!f) return;
        var n = index.df[t];
        score += Math.log(1 + (N - n + 0.5) / (n + 0.5)) * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.len / index.avg))));
      });
      return { d: d, score: score };
    }).filter(function (r) { return r.score > 0; }).sort(function (a, b) { return b.score - a.score; });
    var top = scored.length ? scored[0].score : 0;
    return scored.filter(function (r, i) { return i === 0 || r.score >= top * 0.5; }).slice(0, limit || 3);
  }

  /* ------------------------------------------------------------------
     3. Answers
     ------------------------------------------------------------------ */
  var ALIASES = {
    'postgres': 'PostgreSQL', 'power bi': 'Power BI', 'powerbi': 'Power BI', 'sklearn': 'Scikit-learn',
    'scikit learn': 'Scikit-learn', 'llm': 'LLMs', 'large language models': 'LLMs', 'large language model': 'LLMs',
    'text to sql': 'Text-to-SQL', 'nl2sql': 'Text-to-SQL', 'fast api': 'FastAPI', 'rest api': 'REST APIs',
    'restful': 'REST APIs', 'sentence transformer': 'Sentence Transformers', 'sbert': 'Sentence Transformers',
    'light gbm': 'LightGBM', 'lgbm': 'LightGBM', 'pdf plumber': 'PDFPlumber', 'sql alchemy': 'SQLAlchemy',
    'auth': 'Authentication and session management', 'authentication': 'Authentication and session management',
    'login': 'Authentication and session management', 'session management': 'Authentication and session management',
    'retrieval augmented generation': 'RAG', 'prompting': 'Prompt engineering', 'prompts': 'Prompt engineering',
    'reactjs': 'React', 'react js': 'React', 'my sql': 'MySQL', 'matplot lib': 'Matplotlib', 'multi llm': 'Multi-LLM API integration',
    'python3': 'Python', 'github': 'Git', 'mssql': 'SQL Server', 'sqlserver': 'SQL Server', 'ms sql': 'SQL Server'
  };
  var EXTRA_TERMS = ['Docker', 'OCR', 'MySQL', 'Oracle', 'SQL Server', 'Microsoft SQL Server', 'Reranking', 'Hybrid search', 'Embeddings'];
  var YES_NO = /^(do|does|did|has|have|can|could|is|are|will|would)\b/i;

  function contactBullets(site) {
    var c = site.contact, out = [];
    if (c.email) out.push({ strong: 'Email', text: c.email, href: 'mailto:' + c.email });
    if (c.phone) out.push({ strong: 'Phone', text: c.phone, href: 'tel:' + c.phone.replace(/[^+\d]/g, '') });
    if (c.linkedin) out.push({ strong: 'LinkedIn', text: c.linkedinText || c.linkedin, href: c.linkedin });
    return out;
  }

  /* What a project request needs, compared with what the resume covers. */
  var FIT_AREAS = [
    { re: /\b(rag|retrieval|chat ?bots?|bots?|assistants?|knowledge base|semantic search|vector|llms?|gpt|ai agents?|question answering|ask (my|our|the) (documents|pdfs?|files)|answers? (from|using) (my|our|the) (documents|pdfs?|files|data))\b/i, label: 'RAG and LLM assistants', ids: ['proj-antarkosh', 'proj-vumax', 'exp-etech'] },
    { re: /\b(text[- ]?to[- ]?sql|natural[- ]language (query|access|interface)|sql assistant|talk to (my|our) (database|data)|query (my|our) (database|data))\b/i, label: 'Text-to-SQL over databases', ids: ['proj-antarkosh'] },
    { re: /\b(pdfs?|ocr|document ingestion|table extraction|parse (pdfs?|documents?)|extract (data|text|tables?))\b/i, label: 'PDF parsing, OCR and table extraction', ids: ['proj-antarkosh', 'proj-vumax'] },
    { re: /\b(fast ?api|rest apis?|backend|api)\b/i, label: 'FastAPI backends', ids: ['proj-stash', 'proj-antarkosh'] },
    { re: /\b(react|web ?apps?|websites?|full[- ]?stack|frontend|web application)\b/i, label: 'full-stack web apps (the React frontend skill is basic level)', ids: ['proj-stash'] },
    { re: /\b(dashboards?|power ?bi|analytics|reporting|reports|excel|kpis?)\b/i, label: 'dashboards and data analysis', ids: ['proj-sales'] },
    { re: /\b(predict\w*|forecast\w*|machine learning|ml models?|regression|classification|lightgbm)\b/i, label: 'tabular ML prediction', ids: ['proj-vumax'] },
    { re: /\b(finance|expenses?|budget\w*|accounting|invoices?)\b/i, label: 'finance and expense tracking', ids: ['proj-stash'] },
    { re: /\b(multi[- ]?llm|llm apis?|openai|gemini|claude|groq|prompt\w*)\b/i, label: 'LLM API integration', ids: ['proj-stash'] }
  ];
  var FIT_GAPS = [
    { re: /\b(android|ios|iphone|mobile apps?|flutter|react native|swift|kotlin)\b/i, label: 'native mobile apps' },
    { re: /\b(computer vision|image (recognition|classification|processing)|object detection|video|opencv|yolo|face recognition)\b/i, label: 'computer vision' },
    { re: /\b(speech|voice|text[- ]to[- ]speech|speech[- ]to[- ]text|audio)\b/i, label: 'speech and audio' },
    { re: /\b(fine[- ]?tun\w*|train(ing)? (an? )?(llm|model from scratch|foundation model)|pretrain\w*|reinforcement learning|deep learning|neural networks?|pytorch|tensorflow)\b/i, label: 'model training and fine-tuning' },
    { re: /\b(blockchain|web3|smart contracts?|crypto|solidity|nft)\b/i, label: 'blockchain' },
    { re: /\b(games?|unity|unreal|3d|ar\/vr|vr)\b/i, label: 'games and 3D' },
    { re: /\b(kubernetes|k8s|terraform|devops|ci\/cd|aws|azure|gcp|cloud infrastructure|microservices)\b/i, label: 'DevOps and cloud infrastructure' },
    { re: /\b(embedded|iot|arduino|raspberry|firmware|hardware)\b/i, label: 'embedded systems and hardware' },
    { re: /\b(spark|hadoop|kafka|big data|data warehouse|etl pipelines?|airflow)\b/i, label: 'large-scale data engineering' },
    { re: /\b(sap|salesforce|erp implementation|odoo)\b/i, label: 'enterprise platform customisation' },
    { re: /\b(wordpress|shopify|php|laravel|seo)\b/i, label: 'CMS and e-commerce sites' }
  ];
  function isProjectRequest(q) {
    var wants = /\b(i|we|my (team|company|startup|business))\b.*\b(want|need|would like|am looking|are looking|plan|planning|require|have an idea)\b/i.test(q);
    var build = /\b(build|make|create|develop|design|implement|set up|work on|deliver|code|program|project|chat ?bot|app|application|system|website|dashboard|tool|bot|platform|pipeline|assistant|model|automation)\b/i.test(q);
    var cando = /\b(can|could|would|will|are you able to|is (she|vedanshi) able to)\b.*\b(build|make|create|develop|design|implement|take on|handle|work on|deliver)\b/i.test(q);
    var gig = /\b(freelance|contract work|gig|take (on )?(this|a|my|the) (job|project)|for a project|project idea|work with (us|me)|hire (her|vedanshi) for)\b/i.test(q);
    return (wants && build) || cando || gig;
  }

  function create(site, index) {
    var terms = new Map();
    function addTerm(name) { terms.set(key(name), name); }
    site.skills.forEach(function (g) { g.items.forEach(addTerm); });
    site.projects.forEach(function (p) { p.tags.forEach(addTerm); });
    EXTRA_TERMS.forEach(addTerm);
    Object.keys(ALIASES).forEach(function (a) {
      if (a === 'github') return; // "github" is a contact request, not a skill question
      terms.set(key(a), ALIASES[a]);
      if (!terms.has(key(ALIASES[a]))) addTerm(ALIASES[a]);
    });
    var termKeys = Array.from(terms.keys()).sort(function (a, b) { return b.length - a.length; });

    function findTerms(kq) {
      var s = kq, found = [];
      termKeys.forEach(function (k) {
        if (s.indexOf(k) !== -1) { found.push(terms.get(k)); s = s.split(k).join(' '); }
      });
      return unique(found);
    }
    function termRegex(t) {
      var s = esc(t).replace(/(-|\s)+/g, '[-\\s]?');
      if (/s$/i.test(t) && t.length > 3) s = s.replace(/s$/i, 's?');
      return new RegExp('(^|[^a-z0-9])' + s + '($|[^a-z0-9])', 'i');
    }

    function evidence(term) {
      var re = termRegex(term), tk = key(term), out = [];
      site.exp.forEach(function (e) {
        e.bullets.forEach(function (b) { if (re.test(b)) out.push({ source: e.name, id: e.id, text: b }); });
      });
      site.projects.forEach(function (p) {
        var hit = false;
        p.bullets.forEach(function (b) { if (re.test(b)) { hit = true; out.push({ source: p.name, id: p.id, text: b }); } });
        if (!hit && p.tags.some(function (x) { return key(x) === tk; })) {
          out.push({ source: p.name, id: p.id, text: 'Listed in the ' + p.name + ' tech stack.' });
        }
      });
      site.certs.forEach(function (c) {
        if (re.test(c.name)) out.push({ source: c.name, id: c.id, text: 'Certification' + (c.org ? ', ' + c.org : '') + ', ' + c.date + '.' });
      });
      // one item per source first, then the rest
      var seen = {}, first = [], rest = [];
      out.forEach(function (o) { if (!seen[o.source]) { seen[o.source] = 1; first.push(o); } else rest.push(o); });
      return first.concat(rest);
    }
    function groupsOf(term) {
      var tk = key(term);
      return site.skills.filter(function (g) { return g.items.some(function (i) { return key(i) === tk; }); })
        .map(function (g) { return g.title; });
    }
    function group(re) { return site.skills.filter(function (g) { return re.test(g.title); })[0]; }
    function sourcesOf(list) {
      var seen = {};
      return list.filter(function (s) { if (!s.id || seen[s.id]) return false; seen[s.id] = 1; return true; });
    }
    var contactSrc = [{ label: 'Contact', id: 'contact' }];

    function projectAnswer(p, q) {
      var overview = /\b(tell|about|overview|describe|explain|summar\w*|details?|what is|what's|whats|built|build|did|do|does it do|is)\b/i.test(q) &&
        !/\b(fail\w*|error\w*|fallback|secur\w*|auth\w*|password\w*|offline|retry|export\w*|glossary|report\w*|budget\w*|deploy\w*)\b/i.test(q);
      if (!overview) {
        var hits = search(index, q, function (d) { return d.el && d.el.closest('#' + p.id); }, 2);
        if (hits.length && hits[0].score > 1.2) {
          return { lead: 'From ' + p.name + ':', bullets: hits.map(function (h) { return h.d.text; }), sources: [{ label: p.name, id: p.id }] };
        }
      }
      return {
        lead: p.name + ' is ' + p.brief + '. Built with ' + joinList(p.tags) + '.',
        bullets: p.bullets, sources: [{ label: p.name, id: p.id }]
      };
    }

    function companyAnswer(e) {
      return { lead: 'At ' + e.org + ', Vedanshi ' + e.brief + '.', bullets: e.bullets, sources: [{ label: e.name, id: e.id }] };
    }

    function techAnswer(list, q, special) {
      var yes = YES_NO.test(q) ? 'Yes. ' : '';
      var lead, bullets = [], srcs = [], used = {};
      list.forEach(function (t) {
        evidence(t).slice(0, list.length > 1 ? 2 : 3).forEach(function (ev) {
          var k = ev.id + ev.text;
          if (used[k]) return;
          used[k] = 1;
          bullets.push({ strong: ev.source, id: ev.id, text: ev.text });
          srcs.push({ label: ev.source, id: ev.id });
        });
      });
      var NEG = /\b(planned|evaluating|not yet|future)\b/i;
      var tentative = bullets.filter(function (b) { return NEG.test(b.text); });
      var inUse = bullets.filter(function (b) { return !NEG.test(b.text); });
      var real = inUse.filter(function (b) { return !/^Listed in the /.test(b.text); });
      if (real.length >= 2) inUse = real;                 // drop filler lines when there is real evidence
      bullets = inUse.concat(tentative);
      srcs = bullets.map(function (b) { return { label: b.strong, id: b.id }; });
      if (special) lead = special;
      else if (list.length === 1 && !inUse.length && tentative.length) {
        lead = list[0] + ' is only planned or under evaluation so far, not in use yet.';
      } else if (list.length === 1) {
        var gs = groupsOf(list[0]);
        lead = yes + list[0] + " is on Vedanshi's resume" + (gs.length ? ', listed under ' + joinList(gs) : '') + '.';
      } else lead = yes + joinList(list) + " are all on Vedanshi's resume.";
      if (!bullets.length) {
        srcs.push({ label: 'Skills', id: 'skills' });
      }
      return { lead: lead, bullets: bullets.slice(0, 5), sources: sourcesOf(srcs) };
    }

    function candidates(q) {
      var m = q.match(/\b(?:know|knows|use|used|uses|using|familiar with|experience (?:with|in|of)|worked with|work with|working with|code in|coding in|program in|programming in|proficient in|skilled in)\s+(?:the\s+)?([a-z0-9+#.,&\- ]{2,40}?)\s*\??$/i);
      if (!m) return [];
      return m[1].split(/\s*(?:,|&|\band\b|\bor\b)\s*/i).map(function (s) {
        return norm(s).replace(/^(a|an|the|any)\s+/i, '').replace(/\b(at all|before|well|yet)$/i, '').trim();
      }).filter(function (s) { return s.length > 1 && !/^(vedanshi|you|she|he|it|them|that)$/i.test(s); }).slice(0, 3);
    }

    function skillCheck(q) {
      if (!/\b(know|knows|use|used|uses|using|familiar|experience|worked|work|code|coding|program|programming|proficient|skilled)\b/i.test(q)) return null;
      var cs = candidates(q);
      if (!cs.length) return null;
      var found = [], missing = [];
      cs.forEach(function (c) {
        if (evidence(c).length) found.push(cap(c)); else missing.push(cap(c));
      });
      if (found.length && !missing.length) return techAnswer(found, q);
      var stack = group(/programming/i) || site.skills[0];
      return {
        lead: joinList(missing) + (missing.length > 1 ? " aren't" : " isn't") + " listed on Vedanshi's resume. The programming and backend skills listed are " +
          joinList(stack.items.slice(0, 5)) + '.',
        sources: [{ label: 'Skills', id: 'skills' }]
      };
    }

    function fitAnswer(q) {
      var areas = FIT_AREAS.filter(function (a) { return a.re.test(q); });
      var gaps = FIT_GAPS.filter(function (g) { return g.re.test(q); });
      var labels = areas.map(function (a) { return a.label; });
      var gapLabels = gaps.map(function (g) { return g.label; });
      var centre = 'RAG and LLM assistants, Text-to-SQL, FastAPI backends and data dashboards';
      var verdict, lead;
      if (areas.length && !gaps.length) {
        verdict = 'Good fit.';
        lead = 'This lines up with work Vedanshi has done: ' + joinList(labels) + '.';
      } else if (areas.length && gaps.length) {
        verdict = 'Partial fit.';
        lead = 'Vedanshi has done ' + joinList(labels) + ', but nothing on the resume covers ' + joinList(gapLabels) + '.';
      } else if (gaps.length) {
        verdict = 'Not a match.';
        lead = 'Nothing on the resume covers ' + joinList(gapLabels) + '. The work centres on ' + centre + '.';
      } else {
        verdict = 'Hard to tell from that description.';
        lead = 'The resume centres on ' + centre + '. Send the details and Vedanshi can say whether it fits.';
      }
      var seen = {}, bullets = [];
      areas.forEach(function (a) {
        a.ids.forEach(function (id) {
          if (seen[id] || bullets.length >= 3) return;
          var p = site.projects.filter(function (x) { return x.id === id; })[0];
          var e = site.exp.filter(function (x) { return x.id === id; })[0];
          seen[id] = 1;
          if (p) bullets.push({ strong: p.name, id: p.id, text: cap(p.brief) + '.' });
          else if (e) bullets.push({ strong: e.org, id: e.id, text: e.role + ', ' + e.date + '. ' + cap(e.brief) + '.' });
        });
      });
      bullets.push("Vedanshi is a junior AI engineer, and availability, rates and timelines aren't on the resume, so ask directly:");
      return { verdict: verdict, lead: lead, bullets: bullets.concat(contactBullets(site)) };
    }

    function answer(raw) {
      var q = norm(raw), lq = q.toLowerCase(), kq = key(q);
      var c = site.contact;
      var hasAlias = function (list) { return list.some(function (a) { return a && kq.indexOf(key(a)) !== -1; }); };

      // small talk
      if (/^(hi|hello|hey|hola|namaste|good (morning|afternoon|evening))\b/.test(lq) && lq.split(' ').length < 5) {
        return { lead: "Hi. Ask about Vedanshi's experience, projects, skills, education or certifications." };
      }
      if (/^(thanks|thank you|thx|great|cool|nice|ok|okay)\b/.test(lq) && lq.split(' ').length < 5) {
        return { lead: "You're welcome. Ask another question any time." };
      }

      // CV
      if (/\b(cv|resume|résumé)\b/.test(lq)) {
        return { lead: 'The CV is a PDF.', bullets: [{ strong: 'Download', text: 'Vedanshi_Mesvaniya_Resume.pdf', href: c.cv }] };
      }

      // contact
      if (/\b(contact|e-?mail|mail|phone|mobile (number|no)|whatsapp|call|linkedin|github|reach|get in touch)\b/.test(lq)) {
        var all = [
          { re: /\be-?mail|\bmail\b/, strong: 'Email', text: c.email, href: 'mailto:' + c.email },
          { re: /\bphone\b|\bmobile (number|no)\b|\bwhatsapp\b|\bcall\b/, strong: 'Phone', text: c.phone, href: 'tel:' + (c.phone || '').replace(/[^+\d]/g, '') },
          { re: /linkedin/, strong: 'LinkedIn', text: c.linkedinText, href: c.linkedin },
          { re: /github/, strong: 'GitHub', text: c.githubText, href: c.github }
        ].filter(function (x) { return x.text; });
        var asked = all.filter(function (x) { return x.re.test(lq); });
        var pick = asked.length ? asked : all;
        return { lead: asked.length ? '' : 'You can reach Vedanshi here.', bullets: pick, sources: contactSrc };
      }

      // location
      if (/\b(location|located|city|based|live|lives|living|reside|resides)\b/.test(lq)) {
        return { lead: 'Vedanshi is based in ' + c.place + '.' };
      }

      // someone describing a project they want built
      if (isProjectRequest(q)) return fitAnswer(q);

      // things the resume does not cover
      if (/\b(salary|ctc|compensation|pay|notice period|relocat\w*|visa|age|birthday|married|marital|remote|remotely|onsite|hybrid)\b/.test(lq)) {
        return { lead: "That isn't on Vedanshi's resume. Ask directly:", bullets: contactBullets(site) };
      }

      // availability
      if (/\b(hire|hiring|available|availability|open to|looking for|opportunit\w*|recruit\w*|join)\b/.test(lq)) {
        return { lead: 'Vedanshi is looking for an AI Engineer role to build reliable, real-world AI solutions.',
          bullets: contactBullets(site).concat([{ strong: 'CV', text: 'Download the PDF', href: c.cv }]) };
      }

      // education
      if (/\b(educat\w*|degrees?|studied|study|studies|universit\w*|college|graduat\w*|qualif\w*|academic\w*|school|marks|percentage|aggregate|cgpa|grade)\b/.test(lq) || hasAlias(['mca', 'bca', 'atmiya', 'saurashtra'])) {
        var one = site.edu.filter(function (e) { return hasAlias(e.alias); });
        if (one.length === 1) {
          var e = one[0];
          return { lead: e.degree + ', ' + e.org + '.', bullets: [e.date, e.meta], sources: [{ label: 'Education', id: e.id }] };
        }
        return {
          lead: 'Vedanshi has ' + (site.edu.length === 2 ? 'two' : site.edu.length) + ' degree' + (site.edu.length === 1 ? '' : 's') + '.',
          bullets: site.edu.map(function (x) { return { strong: x.degree, text: x.org + '. ' + x.date + ', ' + x.meta + '.' }; }),
          sources: [{ label: 'Education', id: 'education' }]
        };
      }

      // certifications
      if (/\b(certif\w*|credential\w*|licen[cs]e\w*)\b/.test(lq)) {
        return {
          lead: 'Vedanshi holds ' + (site.certs.length === 2 ? 'two' : site.certs.length) + ' certification' + (site.certs.length === 1 ? '' : 's') + '.',
          bullets: site.certs.map(function (x) { return { strong: x.name, text: (x.org ? x.org + ', ' : '') + x.date + '.' }; }),
          sources: [{ label: 'Certifications', id: 'certifications' }]
        };
      }

      // a named project or company
      var projs = site.projects.filter(function (p) { return hasAlias(p.alias); });
      if (projs.length > 1) {
        return { lead: 'Here is each one.', bullets: projs.map(function (p) { return { strong: p.name, id: p.id, text: cap(p.brief) + '.' }; }),
          sources: projs.map(function (p) { return { label: p.name, id: p.id }; }) };
      }
      if (projs.length === 1) return projectAnswer(projs[0], q);
      var comps = site.exp.filter(function (e) { return hasAlias(e.alias); });
      if (comps.length === 1) return companyAnswer(comps[0]);

      // vector databases
      if (/\bvector\b.*\b(databases?|dbs?|stores?)\b|\bvector (search|index\w*)\b/.test(lq)) {
        var vt = ['Qdrant', 'FAISS'].filter(function (t) { return evidence(t).length; });
        if (vt.length) return techAnswer(vt, q, 'Vedanshi has used ' + joinList(vt) + ' for vector search.');
      }

      // a specific tool or skill
      var found = findTerms(kq);
      if (found.length) return techAnswer(found, q);
      var sc = skillCheck(q);
      if (sc) return sc;

      // skill groups
      var g = null;
      if (/\b(databases?|dbs?)\b/.test(lq)) g = group(/^databases/i);
      else if (/\b(machine learning|ml|deep learning|ai|artificial intelligence)\b/.test(lq) && !/\bai engineer\b/.test(lq)) g = group(/machine learning/i);
      else if (/\b(backend|back end|programming|languages?|tools)\b/.test(lq)) g = group(/programming/i);
      else if (/\b(visuali[sz]ation|charts?)\b/.test(lq)) g = group(/^visualization/i);
      else if (/\b(data analysis|analytics)\b/.test(lq)) g = group(/^data analysis/i);
      else if (/\b(statistics|concepts?|theory)\b/.test(lq)) g = group(/^concepts/i);
      else if (/\b(front ?end|ui)\b/.test(lq)) g = group(/^frontend/i);
      if (g) return { lead: g.title + ': ' + joinList(g.items) + '.', sources: [{ label: 'Skills', id: 'skills' }] };
      if (/\b(skills?|tech stack|stack|technologies|tools|strengths?)\b/.test(lq)) {
        return { lead: "Vedanshi's skills, by area.",
          bullets: site.skills.map(function (s) { return { strong: s.title, text: s.items.join(', ') + '.' }; }),
          sources: [{ label: 'Skills', id: 'skills' }] };
      }

      // projects overall
      if (/\b(projects?|built|build|made|created|developed)\b/.test(lq)) {
        return { lead: 'Vedanshi has ' + site.projects.length + ' projects.',
          bullets: site.projects.map(function (p) { return { strong: p.name, id: p.id, text: cap(p.brief) + '.' }; }),
          sources: [{ label: 'Projects', id: 'projects' }] };
      }

      // experience overall
      if (/\b(experience|work|worked|working|works|job|jobs|employ\w*|career|roles?|compan(y|ies)|intern\w*|currently|current|years?)\b/.test(lq)) {
        var first = site.exp[0], second = site.exp[1];
        return {
          lead: 'Vedanshi works at ' + first.org + (second ? ' and previously ' + (/intern/i.test(second.role) ? 'interned' : 'worked') + ' at ' + second.org : '') + '.',
          bullets: site.exp.map(function (x) { return { strong: x.org, id: x.id, text: x.role + ', ' + x.date + '. ' + cap(x.brief) + '.' }; }),
          sources: site.exp.map(function (x) { return { label: x.name, id: x.id }; })
        };
      }

      // about
      if (/\b(who|about|introduce|yourself|summary|overview|background|profile)\b/.test(lq)) {
        var cur = site.exp[0];
        return {
          lead: 'Vedanshi is an AI Engineer in ' + c.place.split(',')[0] + ', working with Python, LLMs and RAG.',
          bullets: [
            { strong: 'Now', text: cur.role + ' at ' + cur.org + ', since ' + cur.date.replace(/ to present$/i, '') + '.' },
            { strong: 'Projects', text: joinList(site.projects.map(function (p) { return p.name; })) + '.' },
            { strong: 'Education', text: site.edu.map(function (x) { return x.degree.match(/\(([^)]+)\)/)[1] + ' ' + x.date.replace(/\D+/g, ''); }).join(', ') + '.' }
          ],
          sources: [{ label: 'About', id: 'about' }]
        };
      }

      // fallback: closest passages
      var hits = search(index, q, null, 3);
      if (hits.length && hits[0].score > 1) {
        return {
          lead: "Here's what the portfolio says.",
          bullets: hits.map(function (h) { return { strong: h.d.source, id: h.d.targetId, text: h.d.text }; }),
          sources: sourcesOf(hits.map(function (h) { return { label: h.d.source, id: h.d.targetId }; }))
        };
      }
      return {
        lead: "That isn't covered on this portfolio. You can ask Vedanshi directly:",
        bullets: contactBullets(site)
      };
    }
    return answer;
  }

  /* ------------------------------------------------------------------
     4. Chat UI
     ------------------------------------------------------------------ */
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(id) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'ico ico--sm');
    svg.setAttribute('aria-hidden', 'true');
    var use = doc.createElementNS(ns, 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function goTo(id) {
    var target = doc.getElementById(id);
    if (!target) return;
    var isSection = target.tagName === 'SECTION';
    target.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: isSection ? 'start' : 'center' });
    setTimeout(function () {
      if (isSection) return;
      target.classList.remove('flash');
      void target.offsetWidth;
      target.classList.add('flash');
      setTimeout(function () { target.classList.remove('flash'); }, 1700);
    }, reduceMotion() ? 0 : 400);
  }

  function verdictClass(v) { return /^good/i.test(v) ? 'is-good' : /^partial/i.test(v) ? 'is-partial' : /^not/i.test(v) ? 'is-no' : ''; }

  function makeBullet(b) {
    var li = el('li');
    if (typeof b === 'string') { li.textContent = b; return li; }
    if (b.strong) {
      var lab;
      if (b.id) {
        lab = el('button', 'msg__link', b.strong);
        lab.type = 'button';
        lab.addEventListener('click', (function (id) { return function () { goTo(id); }; })(b.id));
      } else lab = el('b', null, b.strong);
      li.appendChild(lab);
      li.appendChild(doc.createTextNode(' '));
    }
    if (b.href) {
      var a = el('a', null, b.text);
      a.href = b.href;
      if (/^https?:/.test(b.href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      li.appendChild(a);
    } else li.appendChild(doc.createTextNode(b.text));
    return li;
  }

  function renderBot(ans) {
    var box = el('div', 'msg msg--bot');
    if (ans.lead || ans.verdict) {
      var p = el('p', 'msg__text');
      if (ans.verdict) { p.appendChild(el('span', 'msg__verdict ' + verdictClass(ans.verdict), ans.verdict)); p.appendChild(doc.createTextNode(' ')); }
      if (ans.lead) p.appendChild(doc.createTextNode(ans.lead));
      box.appendChild(p);
    }
    if (ans.bullets && ans.bullets.length) {
      var ul = el('ul', 'msg__list');
      ans.bullets.forEach(function (b) { ul.appendChild(makeBullet(b)); });
      box.appendChild(ul);
    }
    var covered = (ans.bullets || []).filter(function (b) { return b && b.id; }).map(function (b) { return b.id; });
    var shown = (ans.sources || []).filter(function (s) { return covered.indexOf(s.id) === -1; });
    if (shown.length) {
      var row = el('div', 'msg__src');
      shown.forEach(function (s) {
        var b = el('button', null, s.label);
        b.type = 'button';
        b.appendChild(icon('i-arrow-up-right'));
        b.setAttribute('aria-label', 'Go to ' + s.label + ' on this page');
        b.addEventListener('click', function () { goTo(s.id); });
        row.appendChild(b);
      });
      box.appendChild(row);
    }
    return box;
  }

  /* Model answers arrive as plain text: split into paragraphs and "- " bullets. */
  function parseBlocks(text) {
    var blocks = [], cur = null;
    var clean = function (s) { return s.replace(/\*\*|__|`/g, '').replace(/^#+\s*/, '').trim(); };
    String(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) { cur = null; return; }
      var m = /^(?:[-*\u2022]|\d+[.)])\s+(.*)$/.exec(line);
      if (m) { blocks.push({ type: 'li', text: clean(m[1]) }); cur = null; }
      else if (cur) cur.text += ' ' + clean(line);
      else { cur = { type: 'p', text: clean(line) }; blocks.push(cur); }
    });
    return blocks.filter(function (b) { return b.text; }).slice(0, 8);
  }

  async function typeInto(parent, text, chat) {
    var node = doc.createTextNode('');
    parent.appendChild(node);
    if (reduceMotion()) { node.nodeValue = text; return; }
    var ws = text.split(' '), i = 0;
    while (i < ws.length) {
      i = Math.min(ws.length, i + 2);
      node.nodeValue = ws.slice(0, i).join(' ');
      chat.scrollTop = chat.scrollHeight;
      await sleep(22);
    }
  }

  async function renderRemote(box, data, site, chat) {
    var ul = null;
    var blocks = parseBlocks(data.answer);
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.type === 'li') {
        if (!ul) { ul = el('ul', 'msg__list'); box.appendChild(ul); }
        var li = el('li'); ul.appendChild(li);
        await typeInto(li, b.text, chat);
      } else {
        ul = null;
        var p = el('p', 'msg__text'); box.appendChild(p);
        var m = /^(Good fit|Partial fit|Not a match)\.\s*/.exec(b.text);
        if (m) { p.appendChild(el('span', 'msg__verdict ' + verdictClass(m[1]), m[1] + '. ')); await typeInto(p, b.text.slice(m[0].length), chat); }
        else await typeInto(p, b.text, chat);
      }
    }
    if (data.contact) {
      var cl = el('ul', 'msg__list');
      contactBullets(site).forEach(function (c) { cl.appendChild(makeBullet(c)); });
      box.appendChild(cl);
    }
    chat.scrollTop = chat.scrollHeight;
  }

  function init() {
    var root = $('#ask'), chat = $('#chat'), form = $('#ask-form'), input = $('#ask-input');
    if (!root || !chat || !form || !input) return;

    var site = readSite();
    var index = buildIndex();
    var answer = create(site, index);
    var cfg = window.PORTFOLIO_CONFIG || {};
    var endpoint = String(cfg.askEndpoint || root.getAttribute('data-endpoint') || '').trim();
    var history = [];
    var busy = false;

    // documents dropped into the knowledge folder become searchable too
    loadKnowledge().then(function (items) {
      if (!items.length) return;
      var docs = index.docs.concat(items.map(function (c) { return makeDoc(norm(c.text).slice(0, 420), c.title || c.file, 'Document', '', null, ''); }));
      var f = finalizeIndex(docs);
      index.docs = f.docs; index.df = f.df; index.avg = f.avg;
    });

    function remote(question) {
      if (!endpoint) return Promise.resolve(null);
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, 20000);
      return fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ question: question, history: history.slice(-4) })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { return d && typeof d.answer === 'string' && d.answer.trim() ? { answer: d.answer, contact: !!d.contact } : null; })
        .catch(function () { return null; })
        .then(function (v) { clearTimeout(timer); return v; });
    }

    async function ask(question) {
      question = norm(question);
      if (!question || busy) return;
      busy = true;
      var start = $('#chat-start');
      if (start) start.remove();

      var userMsg = el('div', 'msg msg--user', question);
      chat.appendChild(userMsg);
      var typing = el('div', 'msg msg--bot');
      var dots = el('span', 'typing');
      dots.setAttribute('aria-label', 'Typing');
      dots.appendChild(el('span')); dots.appendChild(el('span')); dots.appendChild(el('span'));
      typing.appendChild(dots);
      chat.appendChild(typing);
      chat.scrollTop = chat.scrollHeight;

      try {
        var local = answer(question);
        var started = Date.now();
        var data = await remote(question);
        var wait = reduceMotion() ? 0 : Math.max(0, 450 - (Date.now() - started));
        if (wait) await sleep(wait);

        var summary;
        if (data) {
          var box = el('div', 'msg msg--bot');
          chat.replaceChild(box, typing);
          await renderRemote(box, data, site, chat);
          summary = data.answer;
        } else {
          chat.replaceChild(renderBot(local), typing);
          chat.scrollTop = Math.max(0, userMsg.offsetTop - 8);
          summary = [local.verdict, local.lead].concat((local.bullets || []).map(function (b) { return typeof b === 'string' ? b : (b.strong ? b.strong + ' ' : '') + b.text; })).filter(Boolean).join(' ');
        }
        history.push({ role: 'user', text: question });
        history.push({ role: 'assistant', text: summary });
      } finally {
        busy = false;
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value;
      input.value = '';
      ask(v);
    });
    var start = $('#chat-start');
    if (start) {
      start.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-q]');
        if (b) ask(b.getAttribute('data-q'));
      });
    }
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();
