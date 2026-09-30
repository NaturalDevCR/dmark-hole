/**
 * Schema migrations. Append only — never edit a migration that has shipped.
 * All timestamps are unix epoch seconds (INTEGER).
 */
export const migrations: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
        created_at INTEGER NOT NULL,
        last_login_at INTEGER
      );

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE domains (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT,
        notes TEXT,
        auto_created INTEGER NOT NULL DEFAULT 0,
        dkim_selectors TEXT NOT NULL DEFAULT '[]',
        dns_checked_at INTEGER,
        dns_result TEXT,
        dns_hash TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE mailboxes (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 993,
        secure INTEGER NOT NULL DEFAULT 1,
        username TEXT NOT NULL,
        password_enc TEXT NOT NULL,
        folder TEXT NOT NULL DEFAULT 'INBOX',
        after_action TEXT NOT NULL DEFAULT 'move' CHECK (after_action IN ('seen', 'move', 'delete')),
        processed_folder TEXT NOT NULL DEFAULT 'DMARC/Processed',
        failed_folder TEXT NOT NULL DEFAULT 'DMARC/Failed',
        only_unseen INTEGER NOT NULL DEFAULT 1,
        tls_reject_unauthorized INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        poll_minutes INTEGER NOT NULL DEFAULT 15,
        last_run_at INTEGER,
        last_status TEXT,
        last_error TEXT,
        total_messages INTEGER NOT NULL DEFAULT 0,
        total_reports INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE reports (
        id INTEGER PRIMARY KEY,
        domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        org_name TEXT NOT NULL,
        org_email TEXT,
        extra_contact TEXT,
        report_id TEXT NOT NULL,
        begin_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        policy_domain TEXT NOT NULL,
        p TEXT, sp TEXT, np TEXT,
        pct INTEGER,
        adkim TEXT, aspf TEXT, fo TEXT,
        testing TEXT,
        version TEXT,
        errors TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        xml_hash TEXT NOT NULL UNIQUE,
        raw_xml BLOB,
        message_count INTEGER NOT NULL DEFAULT 0,
        pass_count INTEGER NOT NULL DEFAULT 0,
        record_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE (org_name, report_id, policy_domain)
      );
      CREATE INDEX idx_reports_domain_begin ON reports(domain_id, begin_ts);
      CREATE INDEX idx_reports_received ON reports(received_at);

      CREATE TABLE records (
        id INTEGER PRIMARY KEY,
        report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        domain_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        begin_ts INTEGER NOT NULL,
        source_ip TEXT NOT NULL,
        count INTEGER NOT NULL,
        disposition TEXT NOT NULL,
        dkim_eval TEXT NOT NULL,
        spf_eval TEXT NOT NULL,
        dmarc_pass INTEGER NOT NULL,
        reasons TEXT NOT NULL DEFAULT '[]',
        header_from TEXT NOT NULL,
        envelope_from TEXT,
        envelope_to TEXT,
        dkim TEXT NOT NULL DEFAULT '[]',
        spf TEXT NOT NULL DEFAULT '[]',
        dkim_auth_pass INTEGER NOT NULL DEFAULT 0,
        spf_auth_pass INTEGER NOT NULL DEFAULT 0,
        dkim_aligned INTEGER NOT NULL DEFAULT 0,
        spf_aligned INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL
      );
      CREATE INDEX idx_records_report ON records(report_id);
      CREATE INDEX idx_records_domain_day ON records(domain_id, day);
      CREATE INDEX idx_records_ip ON records(source_ip);
      CREATE INDEX idx_records_domain_ip ON records(domain_id, source_ip);

      CREATE TABLE ip_info (
        ip TEXT PRIMARY KEY,
        ptr TEXT,
        asn INTEGER,
        as_name TEXT,
        country TEXT,
        provider TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE forensic_reports (
        id INTEGER PRIMARY KEY,
        domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE,
        received_at INTEGER NOT NULL,
        arrival_ts INTEGER,
        reporter TEXT,
        source_ip TEXT,
        feedback_type TEXT,
        auth_failure TEXT,
        delivery_result TEXT,
        reported_domain TEXT,
        original_mail_from TEXT,
        original_rcpt_to TEXT,
        dkim_domain TEXT,
        dkim_selector TEXT,
        spf_dns TEXT,
        subject TEXT,
        message_id TEXT,
        header_from TEXT,
        headers TEXT,
        source TEXT NOT NULL,
        raw_hash TEXT NOT NULL UNIQUE
      );
      CREATE INDEX idx_forensic_domain ON forensic_reports(domain_id, received_at);

      CREATE TABLE alerts (
        id INTEGER PRIMARY KEY,
        domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT NOT NULL DEFAULT '{}',
        dedup_key TEXT,
        created_at INTEGER NOT NULL,
        read_at INTEGER,
        notified_at INTEGER
      );
      CREATE INDEX idx_alerts_created ON alerts(created_at);
      CREATE INDEX idx_alerts_dedup ON alerts(dedup_key, created_at);

      CREATE TABLE ingest_log (
        id INTEGER PRIMARY KEY,
        ts INTEGER NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('ok', 'duplicate', 'error', 'ignored')),
        kind TEXT,
        message TEXT,
        subject TEXT,
        domain TEXT,
        report_ref INTEGER
      );
      CREATE INDEX idx_ingest_log_ts ON ingest_log(ts);

      CREATE TABLE dns_history (
        id INTEGER PRIMARY KEY,
        domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
        checked_at INTEGER NOT NULL,
        hash TEXT NOT NULL,
        records TEXT NOT NULL
      );
      CREATE INDEX idx_dns_history_domain ON dns_history(domain_id, checked_at);
    `,
  },
  {
    version: 2,
    sql: `
      -- Cross-domain dashboards filter by day only.
      CREATE INDEX idx_records_day ON records(day);
    `,
  },
];
