import { getDatabase, closeDatabase } from '../database.js';
import { getLogger } from '../../observability/logger.js';

const logger = getLogger();

interface Migration {
  readonly id: number;
  readonly name: string;
  readonly up: string;
  readonly down: string;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: 'create_migrations_table',
    up: `
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_migrations_name ON migrations(name);
    `,
    down: `
      DROP INDEX IF EXISTS idx_migrations_name;
      DROP TABLE IF EXISTS migrations;
    `,
  },
  {
    id: 2,
    name: 'create_users_table',
    up: `
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'VIEWER',
        is_active BOOLEAN NOT NULL DEFAULT true,
        last_login_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_users_email ON users(email);
      CREATE INDEX idx_users_role ON users(role);
      CREATE INDEX idx_users_is_active ON users(is_active);
    `,
    down: `
      DROP INDEX IF EXISTS idx_users_is_active;
      DROP INDEX IF EXISTS idx_users_role;
      DROP INDEX IF EXISTS idx_users_email;
      DROP TABLE IF EXISTS users;
    `,
  },
  {
    id: 3,
    name: 'create_skus_table',
    up: `
      CREATE TABLE skus (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        retailer VARCHAR(50) NOT NULL,
        product_id VARCHAR(255) NOT NULL,
        product_url TEXT NOT NULL,
        product_name VARCHAR(500) NOT NULL,
        target_price DECIMAL(10, 2),
        current_price DECIMAL(10, 2),
        current_stock_status VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
        monitoring_status VARCHAR(50) NOT NULL DEFAULT 'STOPPED',
        auto_checkout_enabled BOOLEAN NOT NULL DEFAULT false,
        polling_interval_ms INTEGER NOT NULL DEFAULT 30000,
        last_checked_at TIMESTAMP WITH TIME ZONE,
        last_stock_change_at TIMESTAMP WITH TIME ZONE,
        consecutive_errors INTEGER NOT NULL DEFAULT 0,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP WITH TIME ZONE,
        UNIQUE(retailer, product_id)
      );
      CREATE INDEX idx_skus_retailer ON skus(retailer);
      CREATE INDEX idx_skus_monitoring_status ON skus(monitoring_status);
      CREATE INDEX idx_skus_current_stock_status ON skus(current_stock_status);
      CREATE INDEX idx_skus_deleted_at ON skus(deleted_at) WHERE deleted_at IS NULL;
      CREATE INDEX idx_skus_auto_checkout ON skus(auto_checkout_enabled) WHERE auto_checkout_enabled = true;
    `,
    down: `
      DROP INDEX IF EXISTS idx_skus_auto_checkout;
      DROP INDEX IF EXISTS idx_skus_deleted_at;
      DROP INDEX IF EXISTS idx_skus_current_stock_status;
      DROP INDEX IF EXISTS idx_skus_monitoring_status;
      DROP INDEX IF EXISTS idx_skus_retailer;
      DROP TABLE IF EXISTS skus;
    `,
  },
  {
    id: 4,
    name: 'create_retailer_credentials_table',
    up: `
      CREATE TABLE retailer_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        retailer VARCHAR(50) NOT NULL,
        encrypted_username TEXT NOT NULL,
        encrypted_password TEXT NOT NULL,
        encrypted_payment_info TEXT,
        encrypted_shipping_info TEXT,
        is_valid BOOLEAN NOT NULL DEFAULT true,
        last_validated_at TIMESTAMP WITH TIME ZONE,
        expires_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, retailer)
      );
      CREATE INDEX idx_retailer_credentials_user_id ON retailer_credentials(user_id);
      CREATE INDEX idx_retailer_credentials_retailer ON retailer_credentials(retailer);
      CREATE INDEX idx_retailer_credentials_is_valid ON retailer_credentials(is_valid);
    `,
    down: `
      DROP INDEX IF EXISTS idx_retailer_credentials_is_valid;
      DROP INDEX IF EXISTS idx_retailer_credentials_retailer;
      DROP INDEX IF EXISTS idx_retailer_credentials_user_id;
      DROP TABLE IF EXISTS retailer_credentials;
    `,
  },
  {
    id: 5,
    name: 'create_checkout_attempts_table',
    up: `
      CREATE TABLE checkout_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
        credential_id UUID NOT NULL REFERENCES retailer_credentials(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL DEFAULT 'IDLE',
        started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP WITH TIME ZONE,
        failure_reason TEXT,
        error_category VARCHAR(50),
        current_step VARCHAR(100),
        step_history JSONB NOT NULL DEFAULT '[]',
        order_number VARCHAR(255),
        total_price DECIMAL(10, 2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_checkout_attempts_sku_id ON checkout_attempts(sku_id);
      CREATE INDEX idx_checkout_attempts_credential_id ON checkout_attempts(credential_id);
      CREATE INDEX idx_checkout_attempts_status ON checkout_attempts(status);
      CREATE INDEX idx_checkout_attempts_started_at ON checkout_attempts(started_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_checkout_attempts_started_at;
      DROP INDEX IF EXISTS idx_checkout_attempts_status;
      DROP INDEX IF EXISTS idx_checkout_attempts_credential_id;
      DROP INDEX IF EXISTS idx_checkout_attempts_sku_id;
      DROP TABLE IF EXISTS checkout_attempts;
    `,
  },
  {
    id: 6,
    name: 'create_monitoring_events_table',
    up: `
      CREATE TABLE monitoring_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sku_id UUID NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
        event_type VARCHAR(50) NOT NULL,
        previous_stock_status VARCHAR(50),
        new_stock_status VARCHAR(50),
        previous_price DECIMAL(10, 2),
        new_price DECIMAL(10, 2),
        error_category VARCHAR(50),
        error_message TEXT,
        response_time_ms INTEGER NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_monitoring_events_sku_id ON monitoring_events(sku_id);
      CREATE INDEX idx_monitoring_events_event_type ON monitoring_events(event_type);
      CREATE INDEX idx_monitoring_events_created_at ON monitoring_events(created_at);
      CREATE INDEX idx_monitoring_events_sku_created ON monitoring_events(sku_id, created_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_monitoring_events_sku_created;
      DROP INDEX IF EXISTS idx_monitoring_events_created_at;
      DROP INDEX IF EXISTS idx_monitoring_events_event_type;
      DROP INDEX IF EXISTS idx_monitoring_events_sku_id;
      DROP TABLE IF EXISTS monitoring_events;
    `,
  },
  {
    id: 7,
    name: 'create_alerts_table',
    up: `
      CREATE TABLE alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(50) NOT NULL,
        sku_id UUID REFERENCES skus(id) ON DELETE SET NULL,
        title VARCHAR(500) NOT NULL,
        message TEXT NOT NULL,
        severity VARCHAR(50) NOT NULL DEFAULT 'INFO',
        is_read BOOLEAN NOT NULL DEFAULT false,
        acknowledged_at TIMESTAMP WITH TIME ZONE,
        acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_alerts_type ON alerts(type);
      CREATE INDEX idx_alerts_sku_id ON alerts(sku_id);
      CREATE INDEX idx_alerts_severity ON alerts(severity);
      CREATE INDEX idx_alerts_is_read ON alerts(is_read);
      CREATE INDEX idx_alerts_created_at ON alerts(created_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_alerts_created_at;
      DROP INDEX IF EXISTS idx_alerts_is_read;
      DROP INDEX IF EXISTS idx_alerts_severity;
      DROP INDEX IF EXISTS idx_alerts_sku_id;
      DROP INDEX IF EXISTS idx_alerts_type;
      DROP TABLE IF EXISTS alerts;
    `,
  },
  {
    id: 8,
    name: 'create_error_logs_table',
    up: `
      CREATE TABLE error_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category VARCHAR(50) NOT NULL,
        severity VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        stack TEXT,
        context JSONB NOT NULL DEFAULT '{}',
        resolved BOOLEAN NOT NULL DEFAULT false,
        resolved_at TIMESTAMP WITH TIME ZONE,
        resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_error_logs_category ON error_logs(category);
      CREATE INDEX idx_error_logs_severity ON error_logs(severity);
      CREATE INDEX idx_error_logs_resolved ON error_logs(resolved);
      CREATE INDEX idx_error_logs_created_at ON error_logs(created_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_error_logs_created_at;
      DROP INDEX IF EXISTS idx_error_logs_resolved;
      DROP INDEX IF EXISTS idx_error_logs_severity;
      DROP INDEX IF EXISTS idx_error_logs_category;
      DROP TABLE IF EXISTS error_logs;
    `,
  },
  {
    id: 9,
    name: 'create_audit_logs_table',
    up: `
      CREATE TABLE audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(100) NOT NULL,
        entity_id UUID,
        old_values JSONB,
        new_values JSONB,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
      CREATE INDEX idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
      CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
    `,
    down: `
      DROP INDEX IF EXISTS idx_audit_logs_created_at;
      DROP INDEX IF EXISTS idx_audit_logs_entity;
      DROP INDEX IF EXISTS idx_audit_logs_action;
      DROP INDEX IF EXISTS idx_audit_logs_user_id;
      DROP TABLE IF EXISTS audit_logs;
    `,
  },
  {
    id: 10,
    name: 'create_updated_at_trigger',
    up: `
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';

      CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      CREATE TRIGGER update_skus_updated_at BEFORE UPDATE ON skus
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      CREATE TRIGGER update_retailer_credentials_updated_at BEFORE UPDATE ON retailer_credentials
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      CREATE TRIGGER update_checkout_attempts_updated_at BEFORE UPDATE ON checkout_attempts
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      CREATE TRIGGER update_monitoring_events_updated_at BEFORE UPDATE ON monitoring_events
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      CREATE TRIGGER update_alerts_updated_at BEFORE UPDATE ON alerts
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      
      CREATE TRIGGER update_error_logs_updated_at BEFORE UPDATE ON error_logs
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `,
    down: `
      DROP TRIGGER IF EXISTS update_error_logs_updated_at ON error_logs;
      DROP TRIGGER IF EXISTS update_alerts_updated_at ON alerts;
      DROP TRIGGER IF EXISTS update_monitoring_events_updated_at ON monitoring_events;
      DROP TRIGGER IF EXISTS update_checkout_attempts_updated_at ON checkout_attempts;
      DROP TRIGGER IF EXISTS update_retailer_credentials_updated_at ON retailer_credentials;
      DROP TRIGGER IF EXISTS update_skus_updated_at ON skus;
      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      DROP FUNCTION IF EXISTS update_updated_at_column;
    `,
  },  {
    id: 11,
    name: 'fix_skus_table_columns',
    up: `
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS monitoring_status VARCHAR(50) NOT NULL DEFAULT 'STOPPED';
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS auto_checkout_enabled BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS polling_interval_ms INTEGER NOT NULL DEFAULT 30000;
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS last_stock_change_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS consecutive_errors INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS current_stock_status VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN';
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS current_price DECIMAL(10, 2);
      CREATE INDEX IF NOT EXISTS idx_skus_monitoring_status ON skus(monitoring_status);
      CREATE INDEX IF NOT EXISTS idx_skus_deleted_at ON skus(deleted_at) WHERE deleted_at IS NULL;
    `,
    down: `
      -- Intentionally left empty - do not remove columns in rollback
    `,
  },
  {
    id: 12,
    name: 'fix_error_logs_table_columns',
    up: `
      ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS severity VARCHAR(50) NOT NULL DEFAULT 'ERROR';
      ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN';
      CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON error_logs(severity);
    `,
    down: `
      -- Intentionally left empty - do not remove columns in rollback
    `,
  },
  {
    id: 13,
    name: 'fix_all_table_columns',
    up: `
      -- Fix users table
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'USER';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      -- Fix error_logs table
      ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS stack TEXT;
      ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS resolved_by UUID;
      ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
      ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      -- Fix checkout_attempts table
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS sku_id UUID;
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS user_id UUID;
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'IDLE';
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS retailer VARCHAR(50);
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS product_url TEXT;
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS total_price DECIMAL(10, 2);
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS order_number VARCHAR(255);
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS error_message TEXT;
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE checkout_attempts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      -- Fix alerts table
      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS sku_id UUID;
      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS user_id UUID;
      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS type VARCHAR(50) NOT NULL DEFAULT 'ERROR';
      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS title VARCHAR(255) NOT NULL DEFAULT '';
      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'PENDING';
      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE alerts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      -- Fix monitoring_events table
      ALTER TABLE monitoring_events ADD COLUMN IF NOT EXISTS sku_id UUID;
      ALTER TABLE monitoring_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(100);
      ALTER TABLE monitoring_events ADD COLUMN IF NOT EXISTS stock_status VARCHAR(50);
      ALTER TABLE monitoring_events ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2);
      ALTER TABLE monitoring_events ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE monitoring_events ADD COLUMN IF NOT EXISTS error_message TEXT;
      ALTER TABLE monitoring_events ADD COLUMN IF NOT EXISTS response_time_ms INTEGER;
      ALTER TABLE monitoring_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE monitoring_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      -- Fix retailer_credentials table
      ALTER TABLE retailer_credentials ADD COLUMN IF NOT EXISTS user_id UUID;
      ALTER TABLE retailer_credentials ADD COLUMN IF NOT EXISTS retailer VARCHAR(50);
      ALTER TABLE retailer_credentials ADD COLUMN IF NOT EXISTS encrypted_data TEXT NOT NULL DEFAULT '';
      ALTER TABLE retailer_credentials ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE retailer_credentials ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE retailer_credentials ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE retailer_credentials ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE retailer_credentials ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `,
    down: `
      -- Intentionally left empty - do not remove columns in rollback
    `,
  },
  {
    id: 14,
    name: 'fix_not_null_defaults',
    up: `
      -- error_logs.code column exists as NOT NULL with no default — set default
      ALTER TABLE error_logs ALTER COLUMN code SET DEFAULT 'UNKNOWN';
      -- audit_logs may also have similar issues
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `,
    down: `
      -- Intentionally left empty - do not remove columns in rollback
    `,
  },
  {
    id: 15,
    name: 'add_name_to_users',
    up: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255);
    `,
    down: `
      ALTER TABLE users DROP COLUMN IF EXISTS name;
    `,
  },
  {
    id: 16,
    name: 'reconcile_skus_columns',
    up: `
      DO $$
      BEGIN
        -- Rename legacy "sku" column to "product_id"
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='sku'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='product_id'
        ) THEN
          ALTER TABLE skus RENAME COLUMN sku TO product_id;
        END IF;

        -- Rename legacy "name" column to "product_name"
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='name'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='product_name'
        ) THEN
          ALTER TABLE skus RENAME COLUMN name TO product_name;
        END IF;

        -- Rename legacy "url" column to "product_url"
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='url'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='product_url'
        ) THEN
          ALTER TABLE skus RENAME COLUMN url TO product_url;
        END IF;

        -- Rename legacy camelCase "targetprice" to "target_price"
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='targetprice'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='target_price'
        ) THEN
          ALTER TABLE skus RENAME COLUMN targetprice TO target_price;
        END IF;

        -- Rename legacy camelCase "createdat" to "created_at"
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='createdat'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='created_at'
        ) THEN
          ALTER TABLE skus RENAME COLUMN createdat TO created_at;
        END IF;

        -- Rename legacy camelCase "updatedat" to "updated_at"
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='updatedat'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='updated_at'
        ) THEN
          ALTER TABLE skus RENAME COLUMN updatedat TO updated_at;
        END IF;
      END $$;

      -- Add any columns that are still missing after renames
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS product_id VARCHAR(255);
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS product_name VARCHAR(500);
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS product_url TEXT;
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS target_price DECIMAL(10, 2);
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE skus ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      -- Back-fill product_id from id for any rows that have NULL product_id
      UPDATE skus SET product_id = id::text WHERE product_id IS NULL;

      -- Create index on product_id if not already present
      CREATE INDEX IF NOT EXISTS idx_skus_product_id ON skus(product_id);
      CREATE INDEX IF NOT EXISTS idx_skus_retailer_product_id ON skus(retailer, product_id);
    `,
    down: `
      -- Intentionally left empty - column renames cannot be safely reversed with data
    `,
  },
  {
    id: 17,
    name: 'drop_legacy_skus_constraints',
    up: `
      DO $$
      DECLARE
        fk_name TEXT;
      BEGIN
        -- Drop NOT NULL constraint on legacy "userid" column so inserts work without it
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='userid' AND is_nullable='NO'
        ) THEN
          ALTER TABLE skus ALTER COLUMN userid DROP NOT NULL;
        END IF;

        -- Drop any FK constraint referencing users on the userid column
        SELECT tc.constraint_name INTO fk_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'skus'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'userid'
        LIMIT 1;

        IF fk_name IS NOT NULL THEN
          EXECUTE 'ALTER TABLE skus DROP CONSTRAINT ' || quote_ident(fk_name);
        END IF;

        -- Also drop NOT NULL on other legacy columns that are no longer required
        -- isactive, autopurchase, checkintervalminutes may have NOT NULL constraints
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='isactive' AND is_nullable='NO'
        ) THEN
          ALTER TABLE skus ALTER COLUMN isactive DROP NOT NULL;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='autopurchase' AND is_nullable='NO'
        ) THEN
          ALTER TABLE skus ALTER COLUMN autopurchase DROP NOT NULL;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='checkintervalminutes' AND is_nullable='NO'
        ) THEN
          ALTER TABLE skus ALTER COLUMN checkintervalminutes DROP NOT NULL;
        END IF;
      END $$;
    `,
    down: `
      -- Intentionally left empty
    `,
  },
  {
    id: 18,
    name: 'make_skus_userid_nullable',
    up: `
      -- Make userId, product_id, product_name, product_url nullable since they can be NULL during creation
      ALTER TABLE skus ALTER COLUMN "userId" DROP NOT NULL;
      ALTER TABLE skus ALTER COLUMN product_id DROP NOT NULL;
      ALTER TABLE skus ALTER COLUMN product_name DROP NOT NULL;
      ALTER TABLE skus ALTER COLUMN product_url DROP NOT NULL;
      ALTER TABLE skus ALTER COLUMN retailer DROP NOT NULL;
    `,
    down: `
      -- Intentionally left empty
    `,
  },
  {
    id: 19,
    name: 'backfill_skus_legacy_data',
    up: `
      -- Back-fill NULL values from legacy/current columns where possible
      -- Note: sku → product_id, name → product_name, url → product_url in migration 16
      
      DO $$
      BEGIN
        -- Backfill product_id: use existing product_id or fall back to id
        UPDATE skus 
        SET product_id = COALESCE(product_id, id::text)
        WHERE product_id IS NULL;

        -- Backfill product_name from name column if it exists
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='name'
        ) THEN
          UPDATE skus
          SET product_name = COALESCE(product_name, name)
          WHERE product_name IS NULL;
        END IF;

        -- Backfill product_url from url column if it exists
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='skus' AND column_name='url'
        ) THEN
          UPDATE skus
          SET product_url = COALESCE(product_url, url)
          WHERE product_url IS NULL;
        END IF;

        -- Note: retailer is left NULL if not set - the scheduler will validate it
      END $$;
    `,
    down: `
      -- Intentionally left empty
    `,
  },
  {
    id: 20,
    name: 'create_refresh_tokens_table',
    up: `
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMP WITH TIME ZONE
      );
      CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
      CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
      CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_refresh_tokens_expires_at;
      DROP INDEX IF EXISTS idx_refresh_tokens_token_hash;
      DROP INDEX IF EXISTS idx_refresh_tokens_user_id;
      DROP TABLE IF EXISTS refresh_tokens;
    `,
  },
  {
    id: 21,
    name: 'add_name_to_users_if_missing',
    up: `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'name'
        ) THEN
          ALTER TABLE users ADD COLUMN name VARCHAR(255);
        END IF;
      END $$;
    `,
    down: `
      -- Intentionally left empty
    `,
  },
  {
    id: 22,
    name: 'add_missing_retailer_enum_values',
    up: `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'skus_retailer_enum') THEN
          ALTER TYPE skus_retailer_enum ADD VALUE IF NOT EXISTS 'WALMART';
          ALTER TYPE skus_retailer_enum ADD VALUE IF NOT EXISTS 'TARGET';
          ALTER TYPE skus_retailer_enum ADD VALUE IF NOT EXISTS 'NEWEGG';
          ALTER TYPE skus_retailer_enum ADD VALUE IF NOT EXISTS 'POKEMON_CENTER';
          ALTER TYPE skus_retailer_enum ADD VALUE IF NOT EXISTS 'GENERIC';
          ALTER TYPE skus_retailer_enum ADD VALUE IF NOT EXISTS 'CUSTOM';
        END IF;
      END $$;
    `,
    down: `
      -- Cannot remove enum values in PostgreSQL without recreating the type
    `,
  },
];

async function getExecutedMigrations(): Promise<Set<string>> {
  const db = getDatabase();

  try {
    // Check if migrations table exists first
    const tableExists = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'migrations'
      )
    `);
    
    if (!tableExists.rows[0]?.exists) {
      return new Set(); // Table doesn't exist yet
    }
    
    const result = await db.query<{ name: string }>('SELECT name FROM migrations');
    return new Set(result.rows.map((row: { name: string }) => row.name));
  } catch {
    return new Set();
  }
}

async function runUp(): Promise<void> {
  const db = getDatabase();
  const executed = await getExecutedMigrations();

  logger.info('Starting database migrations...');

  for (const migration of migrations) {
    if (executed.has(migration.name)) {
      logger.debug(`Migration "${migration.name}" already executed, skipping`);
      continue;
    }

    logger.info(`Running migration: ${migration.name}`);

    try {
      await db.transaction(async (client) => {
        await client.query(migration.up);
        await client.query('INSERT INTO migrations (name, executed_at) VALUES ($1, CURRENT_TIMESTAMP)', [migration.name]);
      });

      logger.info(`Migration "${migration.name}" completed successfully`);
    } catch (error) {
      logger.error(`Migration "${migration.name}" failed`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  logger.info('All migrations completed');
}

async function runDown(steps: number = 1): Promise<void> {
  const db = getDatabase();
  const executed = await getExecutedMigrations();

  const executedMigrations = migrations
    .filter((m) => executed.has(m.name))
    .reverse()
    .slice(0, steps);

  logger.info(`Rolling back ${executedMigrations.length} migration(s)...`);

  for (const migration of executedMigrations) {
    logger.info(`Rolling back migration: ${migration.name}`);

    try {
      await db.transaction(async (client) => {
        await client.query(migration.down);
        await client.query('DELETE FROM migrations WHERE name = $1', [migration.name]);
      });

      logger.info(`Migration "${migration.name}" rolled back successfully`);
    } catch (error) {
      logger.error(`Rollback of "${migration.name}" failed`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  logger.info('Rollback completed');
}

async function main(): Promise<void> {
  const command = process.argv[2];

  try {
    switch (command) {
      case 'up':
        await runUp();
        break;
      case 'down':
        const steps = parseInt(process.argv[3] ?? '1', 10);
        await runDown(steps);
        break;
      default:
        logger.error('Usage: runner.ts <up|down> [steps]');
        process.exit(1);
    }
  } finally {
    await closeDatabase();
  }
}

// Only run main if this file is executed directly, not when imported
if (require.main === module) {
  main().catch((error) => {
    logger.fatal('Migration runner failed', error instanceof Error ? error : undefined);
    process.exit(1);
  });
}

// Export alias for backward compatibility
export const runMigrations = runUp;

export { migrations, runUp, runDown };
