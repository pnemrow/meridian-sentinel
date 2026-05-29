# Demo Script: Meridian Sentinel

A six minute Demo2Win style walkthrough.

Audience surface: Hunter (reviewing as Sayari FDE lead).
Persona surface: addressed to Meridian Energy Trading SA's compliance function.

Structure follows Demo2Win:
1. ANC opening on slides (Anchor, Need, Cure).
2. Tell, Show, Tell through the application.
3. Architecture beat near the close.
4. Pain recap and partnership close.

**Voice direction.** Baseline is conversational and composed (peer to peer, like walking an experienced colleague through findings). Two moments are explicitly lifted into a rhetorical register, marked `[VOICE C — let it land]` in the script. In those moments, slow down, use the indicated `(pause)` beats, and let the visuals breathe before you speak the next sentence.

Format:
- `[SCREEN: slides]` and `[SCREEN: app]` cue what is on screen.
- *Italicized* lines are stage directions (clicks, transitions).
- Plain prose is what you say.
- `[VOICE C — let it land]` marks the two rhetorical moments.
- `(pause)` inside Voice C means a two beat silence.
- Timing in parentheses at section heads.

Total budget: 6:00. Buffer 15 seconds for breath and transitions.

---

## OPENING (0:00 to 0:50)

### Slide 1, title (5s)

`[SCREEN: slides, slide 1]`

(Hold for two beats while the title settles.)

Meridian Sentinel. A compliance copilot built for Meridian Energy Trading SA.

### Slide 2, Anchor and Need (25s)

*Advance to slide 2.*

In the next six minutes, I want to walk your compliance team through a tool that closes a specific gap your current OFAC screening can't.

Today, every counterparty Meridian onboards flows through a name based OFAC screen. That screen has a structural blind spot, and Meridian is carrying the exposure on every list you process.

Here's the rule. Under OFAC's fifty percent rule, you can't transact with any entity owned at least fifty percent by a sanctioned party, even when the entity's own name never appears on the SDN list. A name screen has no way to see the ownership chain. So when your procurement team onboards a vendor like Russian Railways, your screen returns clean, even though the Russian state controls it through sanctioned parties. That's regulatory exposure, and it's happening on every list you process.

### Slide 3, Cure (20s)

*Advance to slide 3.*

Sentinel closes that gap. It resolves every counterparty name to a real corporate entity. It reconciles three independent signals — your OFAC name screen, Sayari's risk factors, and Sayari's ownership graph. And it surfaces only the disagreements that actually matter to your analyst.

Every finding cites its source.

What you're about to see is a real run against fifty counterparties. Every value on every screen traces back to a Sayari API response on disk. Nothing is simulated.

---

## DEMO (0:50 to 5:00)

### Step 1, landing (8s)

*Advance away from slides, switch to browser tab with the app at the login page.*

`[SCREEN: app, landing page]`

So this is what a compliance analyst at Meridian sees on Monday morning.

*Click "Log in to demo".*

### Step 2, dashboard with pending SFTP investigation (25s)

`[SCREEN: app, investigations dashboard]`

The dashboard is the team's workflow home. Today there's one investigation pending review.

*Point at the "Procurement feed" row, highlighted as pending.*

Notice the source on this one. It didn't arrive because an analyst manually uploaded a spreadsheet. It arrived overnight via SFTP from your procurement system.

Sentinel's designed to fit your existing pipeline, not replace it. Whether your counterparty lists live in SAP Ariba, Snowflake, a watched S3 bucket, or a nightly SFTP drop, Sentinel ingests them on its own schedule.

This is one of the things I'd partner with you on directly. Your existing procurement flow, your existing case management, your existing warehouse. Sentinel writes outcomes back to all of them, so the work shows up where your team already lives.

### Step 3, new investigation, cached run, the Aha (40s)

*Click "+ New investigation".*

`[SCREEN: app, upload surface]`

For this walkthrough I'm starting with the list your team handed off last quarter. Fifty counterparties from the Russian and Eurasian energy sector.

*Drop in the Sayari_Interview_Exercise_List.xlsx file.*

*Step 1 completes. Step 2 shows the parsed preview with column mapping.*

Columns auto detect. Fifty rows, all ready.

*Click "Run screening (cached, instant)".*

This run replays the captured results, which is instant. I'll show you the live API path in a few minutes.

*Step 3 completes. Click "Continue to Compare".*

`[SCREEN: app, Compare surface]`

*Click the "Run composition: expand" chevron at the top.*

Above the funnel you'll see the run composition. Fifty input rows, forty-nine resolved, forty-five sanctioned by some regime, forty exposed to OFAC SDN. The funnel below is the OFAC subset.

*Re-collapse the panel before the Voice-C beat.*

> **[VOICE C — let it land. Two beats of silence after the funnel appears, then speak slowly.]**
>
> This is what your current screening would have missed.
>
> *(pause)*
>
> Fifty counterparties. Forty of them OFAC exposed. A fair name screen, properly configured with transliteration support, catches thirty three of them.
>
> *(pause)*
>
> It misses seven.
>
> Three are directly on the SDN but the name differs by transliteration or aliasing. Four are not on the SDN at all. They're blocked under the fifty percent rule, because a sanctioned party owns or controls them.
>
> Sayari catches all forty.
>
> *(pause)*
>
> The four entities at the bottom of this funnel are the headline. A clean name screen would wave them through. That's real regulatory exposure for Meridian, today.

### Step 4, MiG Corporation, entity detail (25s)

*Click the MiG Corporation gap card.*

`[SCREEN: app, entity detail for MiG Corporation]`

Take MiG Corporation as an example. The name doesn't appear on the SDN, so a name screen finds nothing.

*Point at the risk signals panel.*

Sayari shows otherwise. MiG is sanctioned by Australia, Canada, the EU under regulation eight thirty three twenty fourteen, the US BIS Entity List. Multiple regimes, multiple feeds, every one with a from date and a source listed underneath it.

Notice the Identity Evidence panel on the left. The Russian tax registration numbers, the EU regulation reference. Your analyst has the proof they need without a single document upload from procurement.

### Step 5, ownership graph, traverse to United Aircraft (30s)

*Point at the ownership network on the right.*

And here's the moment a name screen can't reach. Sayari has traced MiG's ownership graph and identified the controlling parent.

*Click the United Aircraft Corporation node.*

The parent is United Aircraft Corporation. It owns nearly seventy five percent of MiG. United Aircraft is directly on the OFAC SDN list.

*Click "Open entity" on the focus card to navigate into United Aircraft.*

`[SCREEN: app, entity detail for United Aircraft Corporation]`

And here's United Aircraft. Sanctioned across eleven regimes. Owns MiG. Owns Sukhoi. Owns Tatneft. All flagged across the same ownership network. One SDN designation, mapped across the entire corporate family. That's what the ownership graph is doing for you.

### Step 6, disposition, API payload, briefing PDF (35s)

*Scroll back to the disposition panel, or just point at the disposition control above the risk signals.*

Let me walk through the closing loop your analyst takes.

This is the maker checker control. Two eyes, four eyes, captured rationale, persisted to disk. Your analyst records the block decision here.

*Click "Set disposition", pick Blocked, type a one line rationale like "Directly sanctioned SDN. Reject onboarding.", click Record.*

Persisted. Survives refresh.

*Click "{ } View API payload".*

`[SCREEN: app, API payload slide over]`

For your downstream systems, every result's available as a structured payload. This is the JSON your case management or warehouse would consume. Every value cited, every field path explicit.

*Close the slide over. Click "Download briefing PDF".*

*The briefing modal appears. Click "Generate briefing". A PDF downloads (or, on a native install without cairo and pango, the same content as HTML — the browser handles save-to-PDF either way).*

`[SCREEN: app, PDF download confirmation]`

And for your audit file, Sentinel renders a server side PDF compliance briefing. Every fact in it points back to the same cache file that drove what you're seeing on screen. That's what attaches to your audit trail when regulators come knocking.

### Step 7, copilot in LIVE mode, freeform question (40s)

*Navigate to the Co-Pilot surface from the sidebar.*

`[SCREEN: app, copilot surface]`

Last piece. The AI copilot. The badge in the top right is currently set to LIVE.

*Click into the message field. Type a question like: "Show me the companies that aren't on the OFAC list but are still blocked."*

*Hit send. The trace pane on the right populates as tools fire.*

Three things are happening on the right side of the screen.

First, the copilot is calling the same typed tools your analysts call directly. Compare reconciliation, then a risk summary on each flagged entity.

Second, every step is cited to a raw cache file.

Third, the answer it produces will only name entities it can prove from tool output. It can't fabricate. The system prompt forbids it, and the typed tools are the only data source it has.

*Wait for the answer to finish streaming.*

The answer here: two entities, both blocked via ownership, both invisible to a name screen. This is the conversational interface to the same reconciliation we just walked through manually.

### Step 8, live upload demonstrating real Sayari API (35s)

*Navigate back to "+ New investigation". Drop the same Sayari_Interview_Exercise_List.xlsx file, this time in LIVE mode (the toggle is already on LIVE).*

`[SCREEN: app, upload surface with LIVE badge visible]`

To prove this isn't just a cached demo, let me run the same vendor list in LIVE mode.

*Click "Run screening live".*

What you're watching is real time API calls to Sayari, one per second to honor your rate limit. Each row is making two calls. Resolution to identify the corporate entity, then the entity endpoint for its full risk profile.

> **[VOICE C — let it land. Slow your pace. Use the pauses.]**
>
> Watch what happens when I click into a row.
>
> *(pause)*
>
> *Expand row 12 or another sanctioned row mid-stream.*
>
> This is the receipts layer.
>
> *(pause)*
>
> The exact endpoint that was called. The payload that was sent. The response summary. The cache file path that was written.
>
> *(pause)*
>
> Every artifact is on disk. Every value cites the field that produced it.
>
> When Meridian's compliance team is asked to defend a decision six months from now, this is where you go.

*Let the run continue a few more seconds while you transition.*

---

## CLOSE (5:00 to 5:50)

### Slide 4, the blind spot closed (30s)

*Switch back to slide deck. Advance to slide 4.*

`[SCREEN: slides, slide 4]`

Before we talk about what comes next, let me close the loop on what we just saw.

The blind spot from the opening, the one your name screen cannot see, is closed. Of fifty counterparties on this list, four were blockable only because Sayari's ownership graph surfaced them. Russian Railways. MiG Corporation. Gazprom. Belorusskaya Kaliynaya Companya. Every one of them, your current pipeline would have onboarded.

Sentinel caught all four. The rationale is cited to source. The audit trail is already on disk. Your analysts can disposition them today.

That's what changes for Meridian on day one.

### Slide 5, partnership (20s)

*Advance to slide 5.*

What you saw today is built. What we'd build together at Meridian is the integration into your specific pipeline.

In the first thirty days, I'd partner with your procurement team to wire the SFTP or warehouse path so your counterparty lists flow in automatically.

In the first sixty days, your case management, your dashboards, your warehouse, all writing back from Sentinel's outcomes.

In the first ninety days, your analyst team trained on the maker checker workflow. And a continuous improvement loop where the patterns Sentinel surfaces feed back into Sayari's roadmap, with me as the conduit.

That's the forward deployed model. Built fast, deployed deep, owned end to end.

Thank you.

---

## RECORDING NOTES

**The two Voice C moments are the points where the demo earns its credibility.** The Compare funnel reveal is where the argument lands. The LIVE row expand is where the "this is real, not vaporware" claim lands. Practice both at full speed and at full pause. The pauses are where the gravity collects.

**The rest of the script is Voice B.** Conversational, composed, peer to peer. If you find yourself getting formal or stilted, you've drifted out of B. The fix is to imagine Hunter sitting across a coffee table, not standing at a podium.

**The Aha pause at the Compare reveal.** Two full beats of silence after the funnel appears, before you speak. That silence is doing more rhetorical work than any sentence you could put there. Trust it.

**The trace expand on row 12.** Slow down. Read each pause. The four short declaratives ("endpoint", "payload", "response", "cache file") should each land like separate observations, not one breath of a list.

**The dashboard SFTP integration row.** Keep it visible long enough that Hunter's eye finds it. The pending investigation arriving overnight via SFTP is the moment that signals you understand pipeline integration, which is half the FDE mandate.

**If you fluff a line, keep going.** Demo2Win discipline says you don't restart, you recap. "Let me back up for a second" works better than starting the take over.

**The closing thank you.** Don't rush it. Two beats of silence after "thank you" before you stop the recording. That ending matters for the impression.
