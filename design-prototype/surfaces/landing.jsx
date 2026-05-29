/* Surface A — Landing / login (pre-auth gate) */

function Landing({ onLogin }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-primary)',
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr',
    }}>
      {/* LEFT — pitch */}
      <div style={{ padding: '60px 80px 80px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        {/* wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <svg width="36" height="36" viewBox="0 0 28 28">
            <rect x="2" y="13" width="24" height="2" fill="var(--accent)" />
            <rect x="6" y="9"  width="16" height="2" fill="var(--accent)" opacity="0.65" />
            <rect x="10" y="17" width="8" height="2" fill="var(--accent)" opacity="0.85" />
            <rect x="13" y="3" width="2" height="22" fill="var(--accent-dim)" opacity="0.6" />
          </svg>
          <div className="mono" style={{ color: 'var(--text-muted)', letterSpacing: 1.4, fontSize: 11, textTransform: 'uppercase' }}>
            Compliance Co-Pilot
          </div>
        </div>

        {/* Headline */}
        <div style={{ maxWidth: 660 }}>
          <div className="serif" style={{ fontSize: 92, lineHeight: 0.95, fontWeight: 600, letterSpacing: -1.5, marginBottom: 6 }}>
            Meridian
          </div>
          <div className="serif" style={{ fontSize: 92, lineHeight: 0.95, fontWeight: 600, letterSpacing: -1.5, color: 'var(--accent)', marginBottom: 28 }}>
            Sentinel
          </div>
          <div className="serif" style={{ fontSize: 26, lineHeight: 1.35, color: 'var(--text-secondary)' }}>
            Resolve every counterparty, screen against OFAC, see who really owns them —
            <span style={{ color: 'var(--text-primary)' }}> every finding traced to source.</span>
          </div>
        </div>

        {/* value props */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 22, maxWidth: 820 }}>
          <ValueProp
            mark="01"
            title="Catches what a name-screen can't"
            body="The 50% rule blocks entities ≥50% owned by a sanctioned party — invisible to string-matching. Sentinel finds them in the ownership graph."
          />
          <ValueProp
            mark="02"
            title="Every answer cites its source"
            body="Each value, each tool call, each AI claim traces to an entity URL, raw field path, and a cached source file. Audit-ready by default."
          />
          <ValueProp
            mark="03"
            title="Fits your existing pipeline"
            body="Drop a CSV, point at SFTP / Snowflake, or POST via webhook. Outcomes write back to your warehouse and case-management."
          />
        </div>
      </div>

      {/* RIGHT — auth card */}
      <div style={{
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border-default)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '60px 60px',
        position: 'relative',
      }}>
        {/* subtle background — sanction halo */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.06 }} viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">
          <circle cx="200" cy="400" r="280" fill="none" stroke="var(--accent)" strokeWidth="0.5" strokeDasharray="2 6" />
          <circle cx="200" cy="400" r="200" fill="none" stroke="var(--accent)" strokeWidth="0.5" strokeDasharray="2 6" />
          <circle cx="200" cy="400" r="120" fill="none" stroke="var(--accent)" strokeWidth="0.5" strokeDasharray="2 6" />
          <circle cx="200" cy="400" r="50" fill="none" stroke="var(--accent)" strokeWidth="0.5" />
        </svg>

        <div style={{
          width: '100%', maxWidth: 360,
          background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
          borderRadius: 8, padding: 32,
          position: 'relative',
        }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 4 }}>
            Tenant
          </div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Meridian Energy Trading SA</div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 24 }}>Geneva · Compliance</div>

          <Field label="Email">
            <input
              defaultValue="p.volkov@meridianenergy.ch"
              style={inputStyle}
              readOnly
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              defaultValue="••••••••••••"
              style={inputStyle}
              readOnly
            />
          </Field>

          <button onClick={onLogin} style={{
            width: '100%',
            background: 'var(--accent)', color: '#0A1628', border: 0,
            padding: '12px 16px', borderRadius: 4, fontWeight: 700, fontSize: 14,
            marginTop: 10,
          }}>Log in to demo →</button>

          <div style={{
            marginTop: 18, display: 'flex', alignItems: 'center', gap: 8,
            color: 'var(--text-muted)', fontSize: 11,
          }}>
            <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
            <span className="mono" style={{ letterSpacing: 1 }}>OR</span>
            <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
          </div>
          <button style={{
            width: '100%', marginTop: 14,
            background: 'transparent', color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)',
            padding: '10px 16px', borderRadius: 4, fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }} onClick={onLogin}>
            <span className="mono" style={{ color: 'var(--accent-dim)', fontSize: 11 }}>SSO</span>
            Continue with Okta
          </button>

          <div className="muted" style={{ fontSize: 11, marginTop: 18, textAlign: 'center', lineHeight: 1.55 }}>
            Demo gate · no real auth. <br/>This sandbox uses recorded real data; the global badge always reflects the live source.
          </div>
        </div>
      </div>
    </div>
  );
}

function ValueProp({ mark, title, body }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="mono" style={{ fontSize: 11, color: 'var(--accent)', letterSpacing: 1.4 }}>{mark}</div>
      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{title}</div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6, fontFamily: 'var(--font-mono)' }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-default)',
  borderRadius: 4,
  padding: '10px 12px',
  fontSize: 13,
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-sans)',
  outline: 'none',
};

Object.assign(window, { Landing });
