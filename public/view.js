// Content comes from the server so the admin's publish state decides what exists here.
let content = { projects: [], posts: [], events: [], tiers: [], spend: [], partners: [], orgTypes: [], supportKinds: [], resources: [], testimonials: [], programs: [], team: [], topics: [], faqs: [] };
// Readable paths: /programs, /blog/<slug>. The server resolves the same path to the same page for
// the share tags, so these two lists are mirrored in server.js — change them together.
const sections = ['team', 'core', 'lab', 'programs', 'events', 'blog', 'partners', 'contact'];
const hasDetail = ['lab', 'blog', 'events'];
const route = (() => {
  const parts = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
  const page = sections.includes(parts[0]) ? parts[0] : 'core';
  return { page, detail: hasDetail.includes(page) && parts[1] ? decodeURIComponent(parts[1]) : '' };
})();
const state = {
  page: route.page,
  detail: route.detail,
  domain: 'All',
  category: 'All',
  tab: 'all',
  currency: 'NGN',
  topic: 'Join the community'
};
const main = document.querySelector('#main');

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}
function hero(eyebrow, title, lede) {
  const index = sections.indexOf(state.page) + 1;
  return `<section class="page-hero dot-grid"><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${lede}</p>${index ? `<span class="page-index">/${String(index).padStart(2, '0')}</span>` : ''}</section>`;
}
function slot(hint, ratio = '16 / 9') {
  return `<div class="photo-slot" style="aspect-ratio:${ratio}"><span>◇</span><p>${esc(hint)}</p><small>IMAGE SLOT · AWAITING ASSET</small></div>`;
}
function chips(items, key) {
  return `<div class="filter-bar" role="group">${items.map((item) => `<button class="chip" data-filter="${key}" data-value="${esc(item.value)}" aria-pressed="${item.on}">${esc(item.label)}${item.count === undefined ? '' : ` <b>${item.count}</b>`}</button>`).join('')}</div>`;
}
function backLink(page, label) {
  return `<a class="back-link" href="/${page}">← ${esc(label)}</a>`;
}
function callout(eyebrow, title, action) {
  return `<section class="detail-callout dot-grid"><p class="eyebrow">${eyebrow}</p><h2>${title}</h2>${action}</section>`;
}
function upcoming() {
  const now = Date.now();
  return content.events.filter((event) => event.startsAt && new Date(event.startsAt).getTime() > now);
}

/* ---------- Core, Programs, Contact ---------- */

const contactForm = `<form data-form="Contact message"><label>Name<input required name="name" placeholder="Your name" /></label><label>Email<input required type="email" name="email" placeholder="you@example.com" /></label><label>What would you like to talk about?<select name="topic"><option>Join the community</option><option>Programs</option><option>Research collaboration</option><option>Partnership</option></select></label><label>Your message<textarea name="idea" placeholder="A sentence or two is plenty"></textarea></label><button class="button" type="submit">Send message <span>→</span></button><p class="form-note"></p></form>`;

function core() {
  return hero('SYNTHAVIA CORE', 'The community<br /><em>engine.</em>', 'Workshops every fortnight, cohorts three times a year, mentorship on request, and open-source projects you can join this week.') +
    `<section class="detail-block"><div><p class="eyebrow">WHAT RUNS INSIDE CORE</p><h2>A room for every<br />stage of the work.</h2></div><div class="cadence">
      <article><b>01</b><h3>Build nights</h3><p>Bring a problem, pair with someone, leave with a commit.</p><small>FORTNIGHTLY · ABA</small></article>
      <article><b>02</b><h3>Study jams</h3><p>Slow, social learning around a real paper, dataset or tool.</p><small>MONTHLY · HYBRID</small></article>
      <article><b>03</b><h3>Open-source sprints</h3><p>Small teams improving useful African AI infrastructure.</p><small>ONGOING · GITHUB</small></article>
      <article><b>04</b><h3>Mentor hours</h3><p>Booked one-to-one time with someone a few steps further along.</p><small>ON REQUEST · REMOTE</small></article>
      <article><b>05</b><h3>Demo days</h3><p>Show the thing you built to a room that will ask real questions.</p><small>END OF EACH COHORT · ABA</small></article>
    </div></section>` +
    `<section class="index-section resource-section"><div class="section-head-simple"><div><p class="eyebrow">RESOURCE LIBRARY</p><h2>Take the work<br />away with you.</h2></div>
      <p class="muted">Everything Core produces is open. A resource appears here once the file is actually published — a link that is still being prepared says so instead of pretending.</p></div>
      ${content.resources.length ? `<div class="resource-list">${content.resources.map((item) => `<article class="${item.url ? '' : 'pending'}">
        <b>${esc(item.kind)}</b>
        <div><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p></div>
        ${item.url ? `<a class="arrow-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Download <span>↓</span></a>`
          : '<span class="status-line"><span class="dot tone-warm"></span>In preparation</span>'}</article>`).join('')}</div>`
        : '<div class="empty-panel"><span>◌</span><div><p class="tag">NOTHING PUBLISHED YET</p><h3>The library is empty.</h3><p>Resources appear here as they are finished.</p></div></div>'}
    </section>` +
    callout('START HERE', 'No fee.<br />No interview.<br /><em>Just begin.</em>', '<a class="button" href="/flow?type=join">Join Synthavia Core <span>→</span></a>');
}

function programs() {
  return hero('SYNTHAVIA PROGRAMS', 'Structured paths<br />into <em>African AI.</em>', 'Three tracks, each designed to take people from intention to a real artefact. Every one states its curriculum, its eligibility and what it costs before you apply.') +
    `<section class="index-section">
      <div class="program-list">${content.programs.map((program) => `<article class="program-card${program.featured ? ' featured' : ''}">
        <div class="program-head">
          <div><p class="tag">${esc(program.kicker)}</p><h2>${esc(program.title)}</h2></div>
          <span class="status-line"><span class="dot tone-${program.tone}"></span>${esc(program.state)}</span>
        </div>
        <p class="program-body">${esc(program.body)}</p>
        <dl class="program-facts">
          <div><dt>Length</dt><dd>${esc(program.dur)}</dd></div>
          <div><dt>Cohort</dt><dd>${esc(program.size)}</dd></div>
          <div><dt>Mode</dt><dd>${esc(program.mode)}</dd></div>
          <div><dt>Cost</dt><dd>${esc(program.cost)}</dd></div>
        </dl>
        <div class="program-detail">
          <div><p class="tag">WHAT YOU DO</p><ul>${program.curriculum.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
          <div><p class="tag">WHO IT IS FOR</p><ul>${program.eligibility.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
        </div>
        <div class="program-foot">
          <p class="dates"><span>⌁</span> ${esc(program.dates)}</p>
          <a class="button ${program.featured ? '' : 'button-quiet'}" href="/flow?type=apply&amp;track=${program.slug}">${esc(program.action)} <span>→</span></a>
        </div></article>`).join('')}</div>
    </section>` +
    callout('APPLICATIONS', 'Three steps.<br /><em>A careful read.</em>', '<a class="button" href="/flow?type=apply">Start an application <span>→</span></a>');
}

function contact() {
  const topic = content.topics.find((item) => item.label === state.topic) || content.topics[0];
  return hero('CONTACT', 'Say hello — in whichever<br />language you prefer.', 'Pick a topic and your message arrives tagged, so it reaches the right person instead of sitting in a queue. English, Pidgin and Igbo are all welcome.') +
    `<section class="contact detail-contact">
      <div>
        <p class="eyebrow">WRITE TO US</p><h2>We read<br />every message.</h2>
        <div class="routing"><p class="tag">WHERE THIS GOES</p><p>This topic is routed to <b>${esc(topic.to)}</b>. Typical reply time is <b>${esc(topic.sla)}</b>.</p></div>
        <dl class="reply-times">${content.topics.map((item) => `<div><dt>${esc(item.label)}</dt><dd>${esc(item.sla)}</dd></div>`).join('')}</dl>
      </div>
      <form data-form="Contact message">
        <label>What is this about? *<select name="topic" data-topic>${content.topics.map((item) => `<option${item.label === topic.label ? ' selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>
        <label>Name *<input required name="name" placeholder="Your name" /></label>
        <label>Email *<input required type="email" name="email" placeholder="you@example.com" /></label>
        <label>Message *<textarea required name="idea" minlength="10" placeholder="A sentence or two is plenty"></textarea></label>
        <label class="check"><input type="checkbox" name="newsletter" />Add me to the newsletter</label>
        <button class="button" type="submit">Send message <span>→</span></button>
        <p class="form-note"></p>
      </form>
    </section>
    <section class="index-section contact-extras">
      <div class="contact-grid">
        <article class="fact-card">${slot('Map embed · 44b Aba Owerri Road, Aba', '4 / 3')}
          <p class="tag">WHERE WE ARE</p><h3>44b Aba Owerri Road,<br />Aba, Abia State.</h3>
          <p class="muted">Nigeria. Come by during office hours — tell us you are coming and someone will be expecting you.</p>
          <p class="muted"><b>Office hours</b> · Mon–Fri, 9:00–17:00 WAT</p></article>
        <article class="fact-card"><p class="tag">DIRECT CHANNELS</p><dl class="channel-list" id="channelList"></dl></article>
        <article class="fact-card"><p class="tag">QUICK ANSWERS</p><dl class="faq-list">${content.faqs.map((item) => `<div><dt>${esc(item.q)}</dt><dd>${esc(item.a)}</dd></div>`).join('')}</dl></article>
      </div>
      <form class="newsletter" data-form="Newsletter signup" data-source="Contact"><div><p class="eyebrow">NEWSLETTER</p><h3>Monthly: programs, research<br />notes, and what the<br />community shipped.</h3><p>One email a month. Unsubscribe in one click.</p></div>
        <div class="newsletter-field"><label>Email address<input required type="email" name="email" placeholder="you@example.com" /></label><button class="button" type="submit">Subscribe <span>→</span></button><p class="form-note"></p></div></form>
      <div class="data-note"><p class="tag">YOUR DATA</p><p>Messages and form submissions are stored in the Synthavia admin, visible only to the team member who owns that topic, and deleted after 12 months. We do not sell data or share it with sponsors. Ask us to delete yours at any time and we will confirm within 7 days.</p></div>
    </section>`;
}

function team() {
  const people = content.team || [];
  return hero('ABOUT &amp; TEAM', 'The people<br />behind <em>the work.</em>', 'Synthavia is built by people who live with the conditions the work is designed for. Every project on this site has a named owner — these are them.') +
    `<section class="index-section">
      ${people.length ? `<div class="team-grid">${people.map((person) => `<article class="team-card">
        ${person.photo ? `<img src="${esc(person.photo)}" alt="${esc(person.name)}" loading="lazy" />` : slot(`Photo of ${person.name}`, '4 / 5')}
        <div class="team-copy">
          <h3>${esc(person.name)}</h3>
          <p class="tag">${esc(person.role)}</p>
          ${person.bio ? `<p>${esc(person.bio)}</p>` : ''}
          ${person.link ? `<a class="arrow-link" href="${esc(person.link)}" target="_blank" rel="noopener noreferrer">Profile <span>↗</span></a>` : ''}
        </div></article>`).join('')}</div>`
      : `<div class="empty-panel"><span>◌</span><div><p class="tag">NOT PUBLISHED YET</p><h3>No team profiles are live.</h3>
          <p>We publish a person only with their own name, role and consent — so this stays empty until each profile is written and approved. Profiles are added in the admin.</p></div></div>`}
      <p class="honesty"><span>⌁</span> Every person listed here owns something on this site. If a name appears, there is work behind it.</p>
    </section>` +
    callout('WORK WITH US', 'The next name here<br /><em>could be yours.</em>', '<a class="button" href="/flow?type=apply">See open programs <span>→</span></a>');
}

/* ---------- Lab ---------- */

function labIndex() {
  const filters = ['All', 'Language', 'Agriculture', 'Vision', 'Enterprise'];
  const shown = state.domain === 'All' ? content.projects : content.projects.filter((project) => project.domains.includes(state.domain));
  return hero('SYNTHAVIA LAB', 'Research that has to survive<br /><em>contact with the field.</em>', 'Open datasets, small models and tools for agriculture, education, African-language NLP and enterprise. Each case study states the problem, the approach, and what we can and cannot yet claim.') +
    `<section class="index-section">
      ${chips(filters.map((value) => ({ value, label: value, on: state.domain === value })), 'domain')}
      <div class="card-grid">${shown.map((project) => `<article class="project-card">
        ${slot(project.photoHint, '16 / 10')}
        <div class="project-card-body">
          <p class="tag">${esc(project.domain)}</p>
          <h3>${esc(project.title)}</h3>
          <p class="project-result">${esc(project.result)}</p>
          <div class="project-metric"><b class="tone-${project.tone}">${esc(project.metric)}</b><small>${esc(project.metricLabel)}</small></div>
          <p class="status-line"><span class="dot tone-${project.tone}"></span>${esc(project.status)}</p>
          <a href="/lab/${project.slug}">Read the case study <span>→</span></a>
        </div></article>`).join('')}</div>
      <p class="honesty"><span>⌁</span> Two more projects are in scoping (education assessment, market-price forecasting). They appear here once they have a written problem statement and an owner.</p>
    </section>` +
    callout('HAVE A FIELD PROBLEM?', 'Bring the question.<br /><em>We’ll test the fit.</em>', '<a class="button" href="/contact">Propose research <span>→</span></a>');
}

function caseStudy(project) {
  return `<section class="page-hero dot-grid detail-hero">
      ${backLink('lab', 'All Lab projects')}
      <p class="eyebrow">${esc(project.domain)} <span class="status-line inline"><span class="dot tone-${project.tone}"></span>${esc(project.status)}</span></p>
      <h1>${esc(project.title)}</h1><p>${esc(project.lede)}</p>
      <span class="page-index">UPDATED ${esc(project.updated).toUpperCase()}</span>
    </section>
    <section class="case-body">
      <div class="case-main">
        <section class="case-step"><span class="step-number">01</span><div><h2>The problem</h2>${project.problem.map((line) => `<p>${esc(line)}</p>`).join('')}
          <blockquote class="pull-quote">“${esc(project.quote.text)}”<cite>${esc(project.quote.source)}</cite></blockquote></div></section>
        <section class="case-step"><span class="step-number">02</span><div><h2>The approach</h2><ol class="approach">${project.steps.map((step) => `<li><b>${esc(step.n)}</b><div><h3>${esc(step.title)}</h3><p>${esc(step.body)}</p></div></li>`).join('')}</ol></div></section>
        <section class="case-step"><span class="step-number">03</span><div><h2>The outcome</h2><p>${esc(project.outcome)}</p>
          <div class="metric-grid">${project.metrics.map((metric) => `<article class="${metric.pending ? 'pending' : ''}"><b>${esc(metric.value)}</b><span>${esc(metric.label)}</span><small>${esc(metric.source)}</small></article>`).join('')}</div>
          <div class="cannot-claim"><p class="tag">WHAT WE CANNOT CLAIM YET</p><p>${esc(project.cannotClaim)}</p></div>
        </div></section>
      </div>
      <aside class="case-aside">
        ${slot(project.photoHint, '4 / 3')}
        <div class="fact-card"><p class="tag">PROJECT FACTS</p><dl>${project.facts.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></div>
        <div class="fact-card accent"><p class="tag">ONE-PAGER</p><p>Problem, method, metrics and contact on a single printable page — for partners, funders and extension services.</p><button class="button button-quiet" data-toast="The one-pager PDF is generated from this page at build time — not wired up in the prototype.">Download PDF <span>↓</span></button></div>
        <div class="fact-card"><p class="tag">WORK ON THIS</p><p>Data collection, annotation and engineering are all open to Core members.</p><a class="arrow-link" href="/flow?type=join">Join the project channel <span>→</span></a></div>
      </aside>
    </section>`;
}

/* ---------- Blog ---------- */

function blogIndex() {
  const categories = ['All', 'Datasets', 'Build notes', 'Community', 'Opinion'];
  const shown = state.category === 'All' ? content.posts : content.posts.filter((post) => post.category === state.category);
  const featured = shown.find((post) => post.featured);
  const rest = shown.filter((post) => post !== featured);
  return hero('BLOG &amp; INSIGHTS', 'Notes from the frontier<br />of <em>African AI.</em>', 'Build notes, dataset releases, cohort write-ups and the occasional strong opinion. We publish when there is something to say — no content calendar theatre.') +
    `<section class="index-section">
      ${chips(categories.map((value) => ({ value, label: value, on: state.category === value, count: value === 'All' ? content.posts.length : content.posts.filter((post) => post.category === value).length })), 'category')}
      ${featured ? `<a class="featured-post" href="/blog/${featured.slug}">
        <div>${slot('Lead image for the featured post', '3 / 2')}</div>
        <div class="featured-copy"><p class="tag">${esc(featured.category)} · ${esc(featured.date)} · ${esc(featured.read)} READ</p><h2>${esc(featured.title)}</h2><p>${esc(featured.dek)}</p>
          <p class="byline"><span class="avatar">${esc(featured.initials)}</span>${esc(featured.author)}</p><span class="arrow-link">Read <span>→</span></span></div></a>` : ''}
      <div class="card-grid">${rest.map((post) => `<a class="post-card" href="/blog/${post.slug}">
        ${slot(post.title, '16 / 10')}
        <div class="post-card-body"><p class="tag">${esc(post.category)} · ${esc(post.date)} · ${esc(post.read)}</p><h3>${esc(post.title)}</h3><p>${esc(post.dek)}</p><small>${esc(post.author)}</small></div></a>`).join('')}</div>
      <div class="archive-end"><span>◌</span><div><p class="tag">END OF THE ARCHIVE</p><h3>That is everything we have published.</h3><p>${content.posts.length} ${content.posts.length === 1 ? 'post' : 'posts'}, all of them real. Anything still being written stays in the admin until it is finished — no teaser cards here.</p></div>
        <a class="arrow-link" href="/contact">Pitch us a guest post <span>→</span></a></div>
      <form class="newsletter" data-form="Newsletter signup" data-source="Blog"><div><p class="eyebrow">GET NEW POSTS BY EMAIL</p><h3>One email per post,<br />plus a monthly roundup.</h3><p>Unsubscribe in one click.</p></div>
        <div class="newsletter-field"><label>Email address<input required type="email" name="email" placeholder="you@example.com" /></label><button class="button" type="submit">Subscribe <span>→</span></button><p class="form-note"></p></div></form>
    </section>`;
}

function article(post) {
  const project = post.project && content.projects.find((item) => item.slug === post.project);
  const sections = post.body.map((section) => `<h2 id="s-${esc(section.h).replace(/\W+/g, '-').toLowerCase()}">${esc(section.h)}</h2>
    ${(section.p || []).map((line) => `<p>${esc(line)}</p>`).join('')}
    ${section.quote ? `<blockquote class="pull-quote">${esc(section.quote)}</blockquote>` : ''}
    ${section.list ? `<ul class="article-list">${section.list.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}`).join('');
  return `<section class="page-hero dot-grid detail-hero article-hero">
      ${backLink('blog', 'All posts')}
      <p class="eyebrow">${esc(post.category)} · ${esc(post.date)} · ${esc(post.read)} READ</p>
      <h1>${esc(post.title)}</h1><p>${esc(post.dek)}</p>
      <p class="byline"><span class="avatar">${esc(post.initials)}</span>${esc(post.author)} · ${esc(post.place)}</p>
    </section>
    <section class="article-body">
      <div class="article-main">${slot('Lead image · caption and credit line set in the admin', '3 / 2')}${sections}
        <div class="share-row"><span>SHARE</span>${['X', 'in', 'URL'].map((label) => `<button class="chip" data-toast="Sharing is wired up at launch, not in the prototype.">${label}</button>`).join('')}</div>
        <div class="tag-row">${post.tags.map((tag) => `<span class="chip static">${esc(tag)}</span>`).join('')}</div>
      </div>
      <aside class="article-aside">
        <div class="fact-card toc-card"><p class="tag">IN THIS ARTICLE</p><ol class="toc">${post.body.map((section) => `<li><a href="#s-${esc(section.h).replace(/\W+/g, '-').toLowerCase()}">${esc(section.h)}</a></li>`).join('')}</ol></div>
        ${project ? `<div class="fact-card accent"><p class="tag">THE PROJECT</p><h3>${esc(project.title)}</h3><p>${esc(post.projectNote)}</p><a class="arrow-link" href="/lab/${project.slug}">Open the case study <span>→</span></a></div>` : ''}
        <form class="fact-card" data-form="Newsletter signup" data-source="Article"><p class="tag">GET NEW POSTS</p><label>Email address<input required type="email" name="email" placeholder="you@example.com" /></label><button class="button button-quiet" type="submit">Subscribe <span>→</span></button><p class="form-note"></p></form>
      </aside>
    </section>`;
}

/* ---------- Events ---------- */

function eventsIndex() {
  const future = upcoming();
  // An event with no start date is neither upcoming nor past: it is listed, but claimed as neither.
  const past = content.events.filter((event) => event.startsAt && !future.includes(event));
  const shown = state.tab === 'upcoming' ? future : state.tab === 'past' ? past : content.events;
  const tabs = [{ value: 'all', label: 'All', count: content.events.length }, { value: 'upcoming', label: 'Upcoming', count: future.length }, { value: 'past', label: 'Past', count: past.length }];
  return hero('SYNTHAVIA EVENTS', 'Where the ecosystem<br /><em>meets.</em>', 'The flagship AI of Things summit, monthly Core meetups, study jams and demo days. Every event keeps its page after it happens — agenda, speakers, recordings and photos stay online.') +
    `<section class="index-section">
      ${chips(tabs.map((tab) => ({ ...tab, on: state.tab === tab.value })), 'tab')}
      ${state.tab !== 'past' && !future.length ? `<div class="empty-panel"><span>◌</span><div><p class="tag">NOTHING DATED YET</p><h3>No confirmed upcoming events.</h3><p>AI of Things 2027 and the next Core cohort are in planning. We publish a date only when the venue is booked — no placeholder countdowns.</p></div>
        <form class="inline-form" data-form="Newsletter signup" data-source="Events"><label>Email for event announcements<input required type="email" name="email" placeholder="you@example.com" /></label><button class="button button-quiet" type="submit">Notify me <span>→</span></button><p class="form-note"></p></form></div>` : ''}
      <div class="event-list">${shown.map((event) => `<article class="event-row">
        <div class="event-row-visual">${event.photo ? `<img src="${esc(event.photo)}" alt="${esc(event.title)}" loading="lazy" />` : slot(event.photoHint, '16 / 10')}</div>
        <div class="event-row-copy"><p class="tag">${esc(event.badge)}</p><h3>${esc(event.title)}<span> — ${esc(event.subtitle)}</span></h3>
          <p>${esc(event.blurb)}</p>
          <dl class="event-meta"><div><dt>Date</dt><dd>${esc(event.date)}</dd></div><div><dt>Venue</dt><dd>${esc(event.venue)}</dd></div><div><dt>Format</dt><dd>${esc(event.format)}</dd></div></dl>
          <div class="chip-row">${event.chips.map((chip) => `<span class="chip static">${esc(chip)}</span>`).join('')}</div>
          <a class="arrow-link" href="/events/${event.slug}">${event.hasGallery ? 'Full recap' : 'Event page'} <span>→</span></a></div></article>`).join('')}</div>
    </section>`;
}

function eventPage(event) {
  const isFuture = event.startsAt && new Date(event.startsAt).getTime() > Date.now();
  return `<section class="page-hero dot-grid detail-hero">
      ${backLink('events', 'All events')}
      <p class="eyebrow">${isFuture ? 'UPCOMING · REGISTRATION OPEN' : 'EVENT CONCLUDED · RECAP LIVE'}</p>
      <h1>${esc(event.title)}<br /><em>${esc(event.subtitle)}</em></h1>
      <dl class="event-meta wide"><div><dt>Date</dt><dd>${esc(event.date)}</dd></div><div><dt>Venue</dt><dd>${esc(event.venue)}</dd></div><div><dt>Format</dt><dd>${esc(event.format)}</dd></div></dl>
      ${isFuture ? `<div class="countdown" data-countdown="${esc(event.startsAt)}"></div>` : ''}
      <div class="hero-actions">${isFuture ? '<a class="button" href="/flow?type=join">Register <span>→</span></a>' : '<button class="button" data-toast="The recording archive is published five days after each event.">Watch the recordings <span>↗</span></button>'}
        <button class="button button-quiet" data-toast="The agenda PDF is generated from the published agenda at launch.">Download agenda (PDF) <span>↓</span></button></div>
    </section>
    ${event.agenda ? `<section class="detail-block event-detail"><div><p class="eyebrow">AGENDA</p><h2>Two days,<br />four tracks.</h2>
        <div class="fact-card"><p class="tag">LIVESTREAM</p><dl>${event.livestream.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><button class="arrow-link" data-toast="The replay playlist goes live with the recording archive.">Open the replay playlist <span>↗</span></button></div></div>
      <div class="agenda">${event.agenda.map((item) => `<article><b>${esc(item.time)}</b><div><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p></div></article>`).join('')}</div></section>
    <section class="detail-block event-detail"><div><p class="eyebrow">SPEAKERS &amp; SESSIONS</p><h2>Photos and bios<br /><em>pending.</em></h2><p class="muted">Names go live when each speaker has confirmed and sent a headshot. Nothing is listed before that.</p></div>
      <div class="speaker-grid">${event.speakers.map((speaker) => `<article class="speaker-card">${slot('Headshot · 4:5, plain background', '4 / 5')}<p class="tag">${esc(speaker.track)}</p><h3>Speaker to confirm</h3><p class="muted">${esc(speaker.role)}</p><p>${esc(speaker.session)}</p></article>`).join('')}</div></section>
    <section class="detail-block event-detail"><div><p class="eyebrow">GETTING THERE</p><h2>Enyimba Hall,<br />Aba.</h2><p class="muted">${esc(event.travel)}</p></div><div>${slot('Map embed · venue pin', '16 / 9')}</div></section>
    ${event.gallery?.length ? `<section class="index-section"><p class="eyebrow">RECAP GALLERY</p><h2>What the room<br />looked like.</h2>
      <div class="gallery">${event.gallery.map((photo) => `<figure class="shot"><img src="${esc(photo.src)}" alt="${esc(photo.caption)}"${photo.w && photo.h ? ` width="${photo.w}" height="${photo.h}"` : ''} loading="lazy" /><figcaption>${esc(photo.caption)}</figcaption></figure>`).join('')}</div>
      <p class="honesty"><span>⌁</span> Photographs from the day, unretouched. Session and speaker photographs are still being collected.</p></section>`
      : event.hasGallery ? `<section class="index-section"><p class="eyebrow">RECAP GALLERY</p><h2>What the room<br />looked like.</h2>
      <div class="gallery">${['Opening keynote', 'Hands-on lab', 'Mini-hackathon', 'Founder track', 'Demo day', 'Closing night'].map((hint) => slot(hint, '4 / 3')).join('')}</div></section>` : ''}` :
      `<section class="index-section"><div class="empty-panel"><span>◇</span><div><p class="tag">ARCHIVE PENDING</p><h3>This event has no page content yet.</h3><p>Agenda, photos and notes are added in the admin. Until they are, this page carries only what we can confirm.</p></div></div></section>`}`;
}

/* ---------- Partners ---------- */

function partners() {
  const currency = state.currency;
  return hero('PARTNERS &amp; SPONSORS', 'Back the ecosystem<br /><em>while it is being built.</em>', 'Universities, government, startups and global AI organisations: fund a cohort, host a lab, sponsor AI of Things, or open a hiring pipeline. Five tiers, plain numbers, no logo goes live before the ink is dry.') +
    `<section class="index-section">
      ${content.partners.length ? `<div class="partner-live"><p class="tag">CURRENT PARTNERS · ${String(content.partners.length).padStart(2, '0')}</p><h2>Signed, and<br /><em>on the record.</em></h2>
        <div class="partner-grid">${content.partners.map((partner) => `<article><b>${esc(partner.name)}</b><span>${esc(partner.tier)}</span></article>`).join('')}</div>
        <p class="honesty"><span>⌁</span> Every mark here sits behind a countersigned agreement. Nothing appears before that.</p></div>`
      : `<div class="partner-empty"><span>◇</span><div><p class="tag">CURRENT PARTNERS · 00</p><h3>Become our first partner.</h3><p>We have had good conversations, but nothing is signed — so this grid stays empty. When your agreement is countersigned, your mark appears here, on the home page strip, and on the AI of Things stage.</p></div>
        <a class="button button-quiet" href="#partner-form">Start the conversation <span>→</span></a></div>
      <div class="ghost-grid">${['Your logo', 'Your logo', 'Your logo', 'Your logo'].map((label) => `<div class="ghost-slot">${esc(label)}</div>`).join('')}</div>`}
    </section>
    <section class="index-section">
      <div class="tier-head"><div><p class="eyebrow">SPONSORSHIP TIERS</p><h2>Annual, and<br />negotiable.</h2><p class="muted">Covering the flagship event plus year-round programs. In-kind support — compute, venues, mentor hours — counts toward a tier.</p></div>
        ${chips([{ value: 'NGN', label: '₦ NGN', on: currency === 'NGN' }, { value: 'USD', label: '$ USD', on: currency === 'USD' }], 'currency')}</div>
      <div class="tier-grid">${content.tiers.map((tier) => `<article class="tier-card${tier.featured ? ' featured' : ''}">
        ${tier.featured ? '<span class="tier-flag">Most impact</span>' : ''}
        <p class="tag">${esc(tier.tag)}</p><h3>${esc(tier.name)}</h3>
        <p class="tier-price"><b>${esc(currency === 'NGN' ? tier.ngn : tier.usd)}</b><small>${tier.ngn === 'In kind' ? '' : '/ year'}</small></p>
        <p class="muted">${esc(tier.who)}</p>
        <ul class="perks">${tier.perks.map((perk) => `<li>${esc(perk)}</li>`).join('')}</ul>
        <button class="button ${tier.featured ? '' : 'button-quiet'}" data-tier="${esc(tier.name)}">Choose ${esc(tier.name)} <span>→</span></button></article>`).join('')}</div>
      <p class="honesty"><span>⌁</span> Tiers are indicative and negotiated per organisation. Government and university partnerships often run on in-kind terms — say what you have, we will find the fit.</p>
    </section>
    <section class="detail-block"><div><p class="eyebrow">WHERE THE MONEY ACTUALLY GOES</p><h2>Four lines.<br />No overhead<br /><em>surprises.</em></h2></div>
      <div class="spend-list">${content.spend.map((item) => `<article><b>${esc(item.pct)}</b><div><h3>${esc(item.label)}</h3><p>${esc(item.note)}</p></div><div class="spend-bar"><span style="width:${esc(item.pct)}"></span></div></article>`).join('')}</div></section>
    <section class="contact detail-contact" id="partner-form">
      <div><p class="eyebrow">PARTNER APPLICATION</p><h2>Tell us what you<br />want to build<br /><em>with us.</em></h2><p>Goes straight to the partnerships lead. You get a reply within five working days, and a call if there is a fit.</p><p class="muted">Or email <b>partners@synthavia.ai</b> directly.</p></div>
      <form data-form="Partner enquiry">
        <label>Organisation *<input required name="organisation" placeholder="Organisation name" /></label>
        <label>Type of organisation<select name="orgType">${content.orgTypes.map((type) => `<option>${esc(type)}</option>`).join('')}</select></label>
        <div class="field-pair"><label>Your name *<input required name="name" placeholder="Your name" /></label><label>Role<input name="role" placeholder="Your role" /></label></div>
        <div class="field-pair"><label>Work email *<input required type="email" name="email" placeholder="you@organisation.com" /></label><label>Website<input name="website" placeholder="organisation.com" /></label></div>
        <label>Tier you have in mind<select name="tier">${[...content.tiers.map((tier) => tier.name), 'Not sure yet'].map((name) => `<option${name === state.tier ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
        <fieldset class="check-grid"><legend>How would you like to support? Pick all that apply</legend>${content.supportKinds.map((kind) => `<label class="check"><input type="checkbox" name="support" value="${esc(kind)}" />${esc(kind)}</label>`).join('')}</fieldset>
        <label>What outcome would make this worth it for you? *<textarea required name="outcome" placeholder="One or two sentences"></textarea></label>
        <label class="check consent"><input type="checkbox" name="consent" />I understand our logo will only be published after a countersigned agreement, and I can approve the wording first.</label>
        <button class="button" type="submit">Send partnership enquiry <span>→</span></button>
        <p class="form-note"></p>
      </form>
    </section>`;
}

/* ---------- Render ---------- */

function markup() {
  if (state.page === 'lab') {
    const project = content.projects.find((item) => item.slug === state.detail);
    return project ? caseStudy(project) : labIndex();
  }
  if (state.page === 'blog') {
    const post = content.posts.find((item) => item.slug === state.detail);
    return post ? article(post) : blogIndex();
  }
  if (state.page === 'events') {
    const event = content.events.find((item) => item.slug === state.detail);
    return event ? eventPage(event) : eventsIndex();
  }
  const pages = { team, core, programs, partners, contact };
  return pages[state.page] ? pages[state.page]() : core();
}

function render() {
  main.innerHTML = markup();
  // The document title is set by the server, which knows the same page and slug — see shareTags().
  main.querySelectorAll('[data-countdown]').forEach(startCountdown);
  fillChannels();
  window.SynthaviaApp?.translate(main);
  window.SynthaviaApp?.markCurrency(main);
}

// Inboxes and the community room are admin settings, so the contact page reads them at render time
// rather than hard-coding addresses that would drift.
async function fillChannels() {
  const list = main.querySelector('#channelList');
  if (!list) return;
  try {
    const { settings } = await (await fetch('/api/settings')).json();
    // Several topics can share one address. Listing it once under every label it covers is honest;
    // repeating it under three headings would imply three desks that do not exist.
    const labelled = [['General', settings.teamEmail], ['Partnerships', settings.partnersEmail], ['Programs', settings.programsEmail]];
    const byAddress = new Map();
    for (const [label, address] of labelled) {
      if (!address) continue;
      byAddress.set(address, (byAddress.get(address) || []).concat(label));
    }
    const rows = [...byAddress].map(([address, labels]) => [labels.join(', '), `<a href="mailto:${esc(address)}">${esc(address)}</a>`]);
    if (settings.whatsapp) rows.push(['Community', `<a href="${esc(settings.whatsapp)}" target="_blank" rel="noopener noreferrer">WhatsApp room ↗</a>`]);
    // GitHub access is granted by hand, so there is no self-serve link to publish.
    rows.push(['GitHub', 'By invite — ask in the WhatsApp room']);
    list.innerHTML = rows.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${value}</dd></div>`).join('')
      || '<div><dt>Inboxes</dt><dd>Not published yet</dd></div>';
  } catch { list.innerHTML = '<div><dt>Inboxes</dt><dd>Unavailable</dd></div>'; }
}

// Changing the topic re-routes the reply-time line, but must not wipe what has been typed.
main.addEventListener('change', (event) => {
  const select = event.target.closest('[data-topic]');
  if (!select) return;
  state.topic = select.value;
  const topic = content.topics.find((item) => item.label === state.topic) || content.topics[0];
  const routing = main.querySelector('.routing p:last-child');
  if (routing) routing.innerHTML = `This topic is routed to <b>${esc(topic.to)}</b>. Typical reply time is <b>${esc(topic.sla)}</b>.`;
});

function startCountdown(element) {
  const target = new Date(element.dataset.countdown).getTime();
  const tick = () => {
    const left = target - Date.now();
    if (left <= 0) return render();
    const units = [['Days', Math.floor(left / 86400000)], ['Hours', Math.floor(left / 3600000) % 24], ['Mins', Math.floor(left / 60000) % 60], ['Secs', Math.floor(left / 1000) % 60]];
    element.innerHTML = units.map(([label, value]) => `<div><b>${String(value).padStart(2, '0')}</b><span>${label}</span></div>`).join('');
  };
  tick();
  window.clearInterval(element.timer);
  element.timer = window.setInterval(tick, 1000);
}

main.addEventListener('click', (event) => {
  const filter = event.target.closest('[data-filter]');
  if (filter) {
    state[filter.dataset.filter] = filter.dataset.value;
    return render();
  }
  const tier = event.target.closest('[data-tier]');
  if (tier) {
    state.tier = tier.dataset.tier;
    render();
    const select = main.querySelector('select[name="tier"]');
    if (select) { select.value = state.tier; select.closest('form').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
});

async function load() {
  try {
    const response = await fetch('/api/content');
    if (!response.ok) throw new Error('unavailable');
    content = await response.json();
    render();
  } catch {
    main.innerHTML = `<section class="index-section"><div class="empty-panel"><span>◌</span><div><p class="tag">CONTENT UNAVAILABLE</p><h3>This page could not load.</h3>
      <p>The Synthavia content service is not reachable. Start the local server with <code>node server.js</code> and reload.</p></div></div></section>`;
  }
}

load();
