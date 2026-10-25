// Drawproof pitch deck generator (six slides, 16:9, light theme).
// Run: DECK_DEPS=<dir whose node_modules has pptxgenjs, sharp, react, react-dom, react-icons> node docs/pitch/build-deck.cjs
// (one-time: mkdir /tmp/deck-tools && cd /tmp/deck-tools && npm i pptxgenjs sharp react react-dom react-icons)
// Output: docs/pitch/Drawproof-Pitch.pptx. Edit copy here, not in PowerPoint, so the deck stays reproducible.
const path = require("path");
const dep = require("module").createRequire(path.join(process.env.DECK_DEPS || __dirname, "deps.cjs"));
const pptxgen = dep("pptxgenjs");
const sharp = dep("sharp");
const React = dep("react");
const { renderToStaticMarkup } = dep("react-dom/server");
const lu = dep("react-icons/lu");

const OUT = path.join(__dirname, "Drawproof-Pitch.pptx");
const ASSETS = path.join(__dirname, "assets");

// ---------- design tokens ----------
const HEAD = "Aptos SemiBold";
const BODY = "Aptos";
const W = 13.333;
const M = 0.7; // side margin
const CW = W - 2 * M; // content width

// Same palette as apps/web: ink, gray, one blue; green/red only for released/held.
const C = { ink: "1D1D1F", ink2: "6E6E73", ink3: "86868B", line: "D2D2D7", surf: "F5F5F7",
  blue: "0071E3", blueTint: "E8F1FC", green: "1A7F37", red: "CF222E" };

// ---------- helpers ----------
const text = (s, t, o) => s.addText(t, { isTextBox: true, margin: 0, fontFace: BODY, valign: "top", color: C.ink, ...o });
const rrect = (s, o) => s.addShape("roundRect", { line: { type: "none" }, rectRadius: 0.16, ...o });
const oval = (s, o) => s.addShape("ellipse", { line: { type: "none" }, ...o });
const hline = (s, x, y, w, color, pt = 0.75) => s.addShape("line", { x, y, w, h: 0, line: { color, width: pt } });
const sub = (s, t) => text(s, t, { x: M, y: 1.2, w: CW, h: 0.4, fontSize: 18, color: C.ink2 });

async function icon(name, color, px = 256) {
  const svg = renderToStaticMarkup(React.createElement(lu[name], { color: "#" + color, size: px, strokeWidth: 1.75 }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

// Pill tags; width estimated from character count at 10.5 pt.
function tags(s, list, x, y, fill = C.surf, color = C.ink2) {
  let tx = x;
  list.forEach((t) => {
    const tw = 0.3 + t.length * 0.068;
    rrect(s, { x: tx, y, w: tw, h: 0.32, fill: { color: fill } });
    text(s, t, { x: tx, y, w: tw, h: 0.32, fontSize: 10.5, color, align: "center", valign: "middle" });
    tx += tw + 0.1;
  });
}

// Milestone rail node: released (green), review (blue with halo), locked (hollow).
function node(s, cx, cy, state, holeFill) {
  if (state === "review") {
    oval(s, { x: cx - 0.21, y: cy - 0.21, w: 0.42, h: 0.42, fill: { color: C.blue, transparency: 80 } });
    oval(s, { x: cx - 0.12, y: cy - 0.12, w: 0.24, h: 0.24, fill: { color: C.blue } });
  } else if (state === "released") {
    oval(s, { x: cx - 0.1, y: cy - 0.1, w: 0.2, h: 0.2, fill: { color: C.green } });
  } else {
    oval(s, { x: cx - 0.1, y: cy - 0.1, w: 0.2, h: 0.2, fill: { color: holeFill }, line: { color: C.ink3, width: 1.25 } });
  }
}

async function build() {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
  pres.title = "Drawproof pitch";
  pres.company = "Drawproof";
  pres.theme = { headFontFace: HEAD, bodyFontFace: BODY };

  const footer = [{ text: { text: "Drawproof", options: { x: M, y: 6.98, w: 3, h: 0.25, margin: 0, fontFace: HEAD,
    fontSize: 10, color: C.ink3 } } }];
  pres.defineSlideMaster({
    title: "Drawproof content",
    background: { color: "FFFFFF" },
    objects: [
      ...footer,
      { placeholder: { options: { name: "title", type: "title", x: M, y: 0.52, w: CW, h: 0.62, margin: 0, fontFace: HEAD,
        fontSize: 34, color: C.ink, align: "left", valign: "top" }, text: "" } },
    ],
    slideNumber: { x: W - M - 0.6, y: 6.98, w: 0.6, h: 0.25, margin: 0, fontFace: BODY, fontSize: 10, color: C.ink3, align: "right" },
  });
  pres.defineSlideMaster({ title: "Drawproof cover", background: { color: "FFFFFF" }, objects: [] });

  const I = {
    scan: await icon("LuScanSearch", C.blue),
    hat: await icon("LuHardHat", C.blue),
    ledger: await icon("LuLandmark", C.blue),
    check: await icon("LuCheck", C.green),
    play: await icon("LuPlay", "FFFFFF"),
    lock: await icon("LuLock", C.blue),
    list: await icon("LuListChecks", C.blue),
    chain: await icon("LuBlocks", C.blue),
  };

  // ======================= 1. Cover =======================
  {
    const s = pres.addSlide({ masterName: "Drawproof cover" });
    text(s, "Drawproof", { x: M, y: 0.55, w: 4, h: 0.45, fontFace: HEAD, fontSize: 24 });
    text(s, "AI & Fintech XRPL Hackathon  ·  Lending Track  ·  NYC 2026", { x: W - M - 6.5, y: 0.66, w: 6.5, h: 0.3,
      fontSize: 12, color: C.ink2, align: "right" });
    text(s, [
      { text: "Construction money should move", options: { breakLine: true } },
      { text: "only when the building does.", options: { color: C.blue } },
    ], { x: M, y: 1.45, w: CW, h: 1.85, fontFace: HEAD, fontSize: 56, lineSpacingMultiple: 0.92 });
    text(s, "Investors fund a project. Each milestone's money waits in an XRP Ledger escrow until a licensed inspector's signed audit and an AI evidence review both pass.",
      { x: M, y: 3.45, w: 8.6, h: 0.8, fontSize: 18, color: C.ink2, lineSpacingMultiple: 1.1 });

    // Product-style milestone panel, same rail as the app's money map
    const px = M, py = 4.55, pw = CW, ph = 2.25;
    rrect(s, { x: px, y: py, w: pw, h: ph, fill: { color: C.surf }, rectRadius: 0.18 });
    text(s, [
      { text: "Maple St duplex", options: { fontFace: HEAD } },
      { text: "   $400K construction loan  ·  5 milestones", options: { color: C.ink2 } },
    ], { x: px + 0.4, y: py + 0.3, w: 7.5, h: 0.32, fontSize: 15 });
    text(s, [
      { text: "$160K released", options: { color: C.green } },
      { text: "   $80K in review", options: { color: C.blue } },
      { text: "   $160K locked", options: { color: C.ink2 } },
    ], { x: px + pw - 5.4, y: py + 0.32, w: 5.0, h: 0.3, fontFace: HEAD, fontSize: 12, align: "right" });

    const ms = [
      ["Foundation", "$60K", "Released", "released"],
      ["Framing", "$100K", "Released", "released"],
      ["Roofing", "$80K", "In review", "review"],
      ["Interiors", "$100K", "Locked", "locked"],
      ["Handover", "$60K", "Locked", "locked"],
    ];
    const rx0 = px + 0.5, step = 2.25, ry = py + 1.0, rx1 = px + pw - 0.4;
    hline(s, rx0, ry, rx1 - rx0, C.line, 1.5);
    hline(s, rx0, ry, 2 * step, C.green, 1.5);
    ms.forEach(([name, amt, status, state], i) => {
      const cx = rx0 + i * step;
      node(s, cx, ry, state, C.surf);
      const tx = cx - 0.1;
      text(s, name, { x: tx, y: ry + 0.27, w: 2.0, h: 0.28, fontSize: 13, color: C.ink2 });
      text(s, amt, { x: tx, y: ry + 0.53, w: 2.0, h: 0.38, fontFace: HEAD, fontSize: 20 });
      const sc = state === "released" ? C.green : state === "review" ? C.blue : C.ink2;
      text(s, status, { x: tx, y: ry + 0.9, w: 2.0, h: 0.26, fontFace: HEAD, fontSize: 11.5, color: sc });
    });
    s.addNotes("0:00–0:08. \"We're Drawproof. Construction money should move only when the building does.\" Do not walk the timeline; it previews the product. Example project figures are illustrative and match the $400K duplex example in docs/07-pitch.md.");
  }

  // ======================= 2. Problem =======================
  {
    const s = pres.addSlide({ masterName: "Drawproof content" });
    s.addText("Construction money moves on trust, not evidence", { placeholder: "title" });
    sub(s, "Investors release funds on a sponsor's word, and find out what happened after the money is gone.");

    text(s, "$62.8M", { x: M, y: 1.95, w: 5.6, h: 1.25, fontFace: HEAD, fontSize: 88, color: C.red });
    text(s, "raised from more than 800 investors through CrowdStreet. The sponsor diverted it, and its CEO was sentenced to 87 months in federal prison.",
      { x: M, y: 3.35, w: 5.3, h: 1.05, fontSize: 17, lineSpacingMultiple: 1.1 });
    text(s, "Source: U.S. Department of Justice, May 20, 2025", { x: M, y: 4.55, w: 5.3, h: 0.25, fontSize: 11, color: C.ink3 });

    const cx = 6.85, cw = W - M - cx;
    const h1 = cw / (1384 / 376), h2 = cw / (1348 / 340);
    const shadow = () => ({ type: "outer", color: "000000", opacity: 0.16, blur: 12, offset: 3, angle: 90 });
    s.addImage({ path: path.join(ASSETS, "press-wsj-crowdstreet.png"), x: cx, y: 1.95, w: cw, h: h1,
      altText: "WSJ headline: Missing millions and a rabbinical arbitrator, a real-estate deal gone bad hits popular crowd funder", shadow: shadow() });
    s.addImage({ path: path.join(ASSETS, "press-cnbc-yieldstreet.png"), x: cx, y: 1.95 + h1 + 0.22, w: cw, h: h2,
      altText: "CNBC headline: $208 million wiped out, Yieldstreet investors rack up more losses as firm rebrands to Willow Wealth", shadow: shadow() });

    hline(s, M, 5.5, CW, C.line);
    const stats = [
      ["$453.5B", "in U.S. construction and development loans on bank balance sheets (FDIC via NAHB, Q2 2026)"],
      ["5–14 days", "from a builder's draw request to funding at today's lenders (Built Technologies)"],
      ["~30%", "of CRE-fraud reports to FinCEN involved misappropriated funds (FinCEN, 2011)"],
    ];
    const colW = (CW - 2 * 0.4) / 3;
    stats.forEach(([v, d], i) => {
      const x = M + i * (colW + 0.4);
      text(s, v, { x, y: 5.7, w: colW, h: 0.48, fontFace: HEAD, fontSize: 26 });
      text(s, d, { x, y: 6.22, w: colW - 0.1, h: 0.55, fontSize: 12, color: C.ink2, lineSpacingMultiple: 1.05 });
    });
    s.addNotes("0:08–0:30. \"More than 800 investors put approximately $62.8 million into the Nightingale deals on CrowdStreet. The sponsor diverted the funds. It keeps happening: Yieldstreet investors have lost hundreds of millions. Construction lenders face the same gap every draw: money goes out on a sponsor's word, not on evidence the work happened.\" Use the case as motivation for accountability; do not claim Drawproof would have prevented the entire fraud. Sources: https://www.justice.gov/usao-ndga/pr/head-commercial-real-estate-investment-firm-sentenced-federal-prison-628-million-fraud ; NAHB/FDIC https://eyeonhousing.org/2026/08/single-family-adc-lending-falls-back-in-q2/ ; Built (vendor) via Bisnow; FinCEN CRE Financing Fraud report (2011).");
  }

  // ======================= 3. How we address it =======================
  {
    const s = pres.addSlide({ masterName: "Drawproof content" });
    s.addText("Every draw must pass its test suite", { placeholder: "title" });
    sub(s, "Like a software release: every check passes, the draw is paid. One fails, the money stays locked.");

    const cols = [
      [I.scan, "Automated review", "AI and rule checks across every photo, invoice and audit",
        ["Photo location matches the site", "Reused photos detected", "Invoices match the budget"]],
      [I.hat, "Licensed inspector", "Visits the site and signs the audit",
        ["Assigned by Drawproof", "Signs with their own key", "Required for every release"]],
      [I.ledger, "XRP Ledger", "Holds the money and keeps the record",
        ["Vault pools investor RLUSD", "Escrow fixes the payee", "Results recorded on-chain"]],
    ];
    const gap = 0.3, cw = (CW - 2 * gap) / 3, cy = 2.0, ch = 4.1;
    cols.forEach(([ic, name, role, rows], i) => {
      const x = M + i * (cw + gap);
      rrect(s, { x, y: cy, w: cw, h: ch, fill: { color: C.surf } });
      rrect(s, { x: x + 0.4, y: cy + 0.4, w: 0.62, h: 0.62, fill: { color: "FFFFFF" }, rectRadius: 0.12 });
      s.addImage({ data: ic, x: x + 0.53, y: cy + 0.53, w: 0.36, h: 0.36 });
      text(s, name, { x: x + 0.4, y: cy + 1.25, w: cw - 0.8, h: 0.42, fontFace: HEAD, fontSize: 22 });
      text(s, role, { x: x + 0.4, y: cy + 1.72, w: cw - 0.8, h: 0.62, fontSize: 14, color: C.ink2, lineSpacingMultiple: 1.05 });
      hline(s, x + 0.4, cy + 2.5, cw - 0.8, C.line);
      rows.forEach((r, j) => {
        const ry = cy + 2.75 + j * 0.42;
        s.addImage({ data: I.check, x: x + 0.4, y: ry + 0.03, w: 0.2, h: 0.2 });
        text(s, r, { x: x + 0.72, y: ry, w: cw - 1.1, h: 0.3, fontSize: 14 });
      });
    });
    text(s, "Drawproof's release service finishes an escrow only after every required check passes. The ledger fixes where the money can go and when it expires.",
      { x: M, y: 6.33, w: CW, h: 0.3, fontSize: 12, color: C.ink3 });
    s.addNotes("0:30–0:45. \"Every draw has a test suite. Our automated review checks the builder's evidence for consistency: location, reused photos, invoices against the budget. A licensed inspector, assigned by us and not the builder, visits the site and signs the audit. The XRP Ledger holds the money in escrow and records every result.\" Duplicate-photo matching is deterministic, not model reasoning. The platform's release service controls timing; the ledger does not evaluate the AI verdict.");
  }

  // ======================= 4. How it works =======================
  {
    const s = pres.addSlide({ masterName: "Drawproof content" });
    s.addText("From investor deposit to verified draw", { placeholder: "title" });
    sub(s, "Native XRP Ledger features carry the money. No custom smart contract holds the funds.");

    const steps = [
      ["Fund", "Verified investors deposit RLUSD into the project's vault and receive shares.", ["Single Asset Vault", "Credentials"]],
      ["Lock", "The vault lends to a multisig project account, with one escrow per milestone.", ["Lending Protocol", "Token Escrow"]],
      ["Review", "The builder uploads evidence, the inspector signs the audit, and each result is recorded.", ["Signed attestations"]],
      ["Release or hold", null, ["EscrowFinish", "CancelAfter"]],
    ];
    const step = CW / 4, ny = 2.15, d = 0.48;
    hline(s, M + d / 2, ny + d / 2, 3 * step, C.line, 1.5);
    steps.forEach(([title, desc, tg], i) => {
      const x = M + i * step;
      oval(s, { x, y: ny, w: d, h: d, fill: { color: C.blue } });
      text(s, String(i + 1), { x, y: ny, w: d, h: d, fontFace: HEAD, fontSize: 15, color: "FFFFFF", align: "center", valign: "middle" });
      text(s, title, { x, y: ny + 0.75, w: step - 0.35, h: 0.42, fontFace: HEAD, fontSize: 21 });
      if (desc) {
        text(s, desc, { x, y: ny + 1.22, w: step - 0.45, h: 1.0, fontSize: 14, color: C.ink2, lineSpacingMultiple: 1.08 });
      } else {
        const out = [[C.green, "Pass", "paid to the builder"], [C.red, "Fail", "stays locked in escrow"]];
        out.forEach(([c, k, v], j) => {
          const oy = ny + 1.27 + j * 0.46;
          oval(s, { x, y: oy + 0.07, w: 0.14, h: 0.14, fill: { color: c } });
          text(s, [{ text: k + "  ", options: { fontFace: HEAD, color: c } }, { text: v, options: { color: C.ink2 } }],
            { x: x + 0.26, y: oy, w: step - 0.4, h: 0.3, fontSize: 14 });
        });
      }
      tags(s, tg, x, ny + 2.35);
    });

    // Devnet proof panel
    const py = 5.3, ph = 1.3;
    rrect(s, { x: M, y: py, w: CW, h: ph, fill: { color: C.blueTint } });
    text(s, "28", { x: M + 0.45, y: py + 0.2, w: 1.3, h: 0.9, fontFace: HEAD, fontSize: 54, color: C.blue, valign: "middle" });
    text(s, "XRPL Devnet transactions run one project's full money path", { x: M + 1.85, y: py + 0.3, w: 9.5, h: 0.36,
      fontFace: HEAD, fontSize: 17 });
    text(s, "Credentials, vault deposits, loan to a multisig project account, milestone escrows, signed audit record and release. Every transaction links to the public explorer.",
      { x: M + 1.85, y: py + 0.68, w: 9.6, h: 0.5, fontSize: 12.5, color: C.ink2 });
    s.addNotes("0:45–1:00. \"Investors fund the project's vault. The vault lends to a multisig project account, and each milestone is locked in its own escrow. Evidence is reviewed. Pass, and the builder is paid. Fail, and the money stays locked.\" Proof: docs/proof-devnet-2026-10-25-v2.md, demo run: 28 transactions plus one expected tec. Devnet only; Vault and Lending Protocol are not on mainnet yet.");
  }

  // ======================= 5. Demo =======================
  {
    const s = pres.addSlide({ masterName: "Drawproof content" });
    s.addText("Demo: one draw released, one held", { placeholder: "title" });
    text(s, "Recorded  ·  1:40  ·  XRPL Devnet  ·  Edited for time", { x: W - M - 5, y: 0.66, w: 5, h: 0.3, fontSize: 12,
      color: C.ink2, align: "right" });

    const vx = M, vy = 1.4, vw = 8.5, vh = vw * 9 / 16;
    rrect(s, { x: vx, y: vy, w: vw, h: vh, fill: { color: C.surf }, line: { color: C.line, width: 1 }, rectRadius: 0.12,
      objectName: "VIDEO_PLACEHOLDER" });
    oval(s, { x: vx + vw / 2 - 0.45, y: vy + vh / 2 - 0.6, w: 0.9, h: 0.9, fill: { color: C.ink } });
    s.addImage({ data: I.play, x: vx + vw / 2 - 0.15, y: vy + vh / 2 - 0.33, w: 0.36, h: 0.36 });
    text(s, "Replace with the demo video: Insert › Video › This Device, sized to this frame", { x: vx, y: vy + vh / 2 + 0.5, w: vw, h: 0.3,
      fontSize: 12, color: C.ink2, align: "center" });

    const rx = vx + vw + 0.5, rw = W - M - rx;
    text(s, "What to watch", { x: rx, y: vy, w: rw, h: 0.3, fontFace: HEAD, fontSize: 13, color: C.ink2 });
    const beats = [
      ["0:00", "Maple St funded, draws locked", null],
      ["0:10", "Inspector signs the site audit", null],
      ["0:30", "Checks run with readable reasons", null],
      ["0:50", "Milestone 1 passes and is paid", C.green],
      ["1:10", "Milestone 2 reuses a photo and stays locked", C.red],
    ];
    const by = vy + 0.6, bstep = 0.84;
    s.addShape("line", { x: rx + 0.065, y: by + 0.1, w: 0, h: bstep * (beats.length - 1), line: { color: C.line, width: 1.25 } });
    beats.forEach(([t, b, c], i) => {
      const y = by + i * bstep;
      oval(s, { x: rx, y: y + 0.04, w: 0.13, h: 0.13, fill: { color: c || C.ink3 } });
      text(s, t, { x: rx + 0.35, y, w: 0.6, h: 0.25, fontFace: HEAD, fontSize: 12, color: c || C.blue });
      text(s, b, { x: rx + 0.35, y: y + 0.25, w: rw - 0.35, h: 0.5, fontSize: 14 });
    });
    text(s, "Devnet prototype with a mock RLUSD token. The AI mode is labeled on screen. Not an offer to invest.",
      { x: M, y: vy + vh + 0.22, w: vw, h: 0.3, fontSize: 11, color: C.ink3 });
    s.addNotes("1:00–2:40. Play the local MP4 (silent, live narration) per docs/04-demo-script.md. Keep the project and milestone visible; show review before signing or paying; end on the failed milestone still locked. Label the actual verifier mode (mock judgments unless a live run is validated in the recording). Do not narrate the old 'Ledger says no' beat.");
  }

  // ======================= 6. Close: recap, business, questions =======================
  {
    const s = pres.addSlide({ masterName: "Drawproof cover" });
    text(s, "Drawproof", { x: M, y: 0.55, w: 4, h: 0.45, fontFace: HEAD, fontSize: 24 });
    text(s, "AI & Fintech XRPL Hackathon  ·  Lending Track  ·  NYC 2026", { x: W - M - 6.5, y: 0.66, w: 6.5, h: 0.3,
      fontSize: 12, color: C.ink2, align: "right" });
    text(s, [
      { text: "Thank you.", options: { breakLine: true } },
      { text: "Questions?", options: { color: C.blue } },
    ], { x: M, y: 1.4, w: 6, h: 1.75, fontFace: HEAD, fontSize: 56, lineSpacingMultiple: 0.92 });

    // Left: what we built (the three takeaways)
    text(s, "What we built this weekend", { x: M, y: 3.6, w: 5.6, h: 0.3, fontFace: HEAD, fontSize: 13, color: C.ink2 });
    const built = [
      [I.lock, "Milestone escrows on the XRP Ledger", "Each draw can only go to the builder or back to the project."],
      [I.list, "A test suite for every draw", "Signed inspector audit plus AI evidence review gate each release."],
      [I.chain, "Full money path on XRPL Devnet", "28 transactions: vault, loan, escrows, audit record, release."],
    ];
    built.forEach(([ic, k, v], i) => {
      const y = 4.05 + i * 0.95;
      rrect(s, { x: M, y, w: 0.56, h: 0.56, fill: { color: C.blueTint }, rectRadius: 0.12 });
      s.addImage({ data: ic, x: M + 0.14, y: y + 0.14, w: 0.28, h: 0.28 });
      text(s, k, { x: M + 0.8, y: y - 0.02, w: 5.1, h: 0.32, fontFace: HEAD, fontSize: 16 });
      text(s, v, { x: M + 0.8, y: y + 0.3, w: 5.1, h: 0.3, fontSize: 13, color: C.ink2 });
    });

    // Right: business model panel
    const bx = 7.15, bw = W - M - bx, by = 1.45, bh = 5.35;
    rrect(s, { x: bx, y: by, w: bw, h: bh, fill: { color: C.surf }, rectRadius: 0.18 });
    text(s, "How Drawproof earns", { x: bx + 0.45, y: by + 0.4, w: bw - 0.9, h: 0.38, fontFace: HEAD, fontSize: 20 });
    const fees = [
      ["Verification fee", "per project, builder pays"],
      ["Origination fee", "1.5–2% at loan close"],
      ["Management fee", "~10% of loan interest"],
      ["First-loss cover", "we post 10%, lose first"],
    ];
    fees.forEach(([k, v], i) => {
      const y = by + 1.05 + i * 0.6;
      if (i) hline(s, bx + 0.45, y - 0.12, bw - 0.9, C.line);
      text(s, k, { x: bx + 0.45, y, w: 2.3, h: 0.32, fontFace: HEAD, fontSize: 15 });
      text(s, v, { x: bx + 2.75, y, w: bw - 3.2, h: 0.32, fontSize: 15, color: i === 3 ? C.green : C.ink2, align: "right" });
    });
    text(s, "$400K duplex, 9 months, 5 draws ≈ $12.5K platform revenue (~3%). Illustrative, not a forecast.",
      { x: bx + 0.45, y: by + 3.45, w: bw - 0.9, h: 0.5, fontSize: 12, color: C.ink3 });
    hline(s, bx + 0.45, by + 4.15, bw - 0.9, C.line);
    text(s, [
      { text: "Next: ", options: { fontFace: HEAD, color: C.ink } },
      { text: "one construction-lending pilot", options: { fontFace: HEAD, color: C.blue } },
    ], { x: bx + 0.45, y: by + 4.4, w: bw - 0.9, h: 0.4, fontSize: 18 });

    s.addNotes("2:40–2:50. \"We earn verification, origination, and management fees, and we post first-loss cover, so we lose first if we verify a bad project. Next, we're looking for one construction-lending pilot. Thank you. Happy to take questions.\" Leave this slide up for Q&A. Unit economics from docs/07-pitch.md: fee $500 + origination $8,000 + inspections $1,250 + management ≈ $2,700 ≈ $12.5K; not a forecast. Regulatory framing and Smart Escrows roadmap are Q&A only (docs/judge-faq.md).");
  }

  await pres.writeFile({ fileName: OUT });
  console.log("wrote", OUT);
}

build().catch((e) => { console.error(e); process.exit(1); });
