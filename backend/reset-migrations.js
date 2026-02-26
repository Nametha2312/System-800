const { Client } = require('pg');
require('dotenv').config();

async function resetDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  
  try {
    await client.connect();
    console.log('Connected to database');
    
    // List of all tables that might exist (in reverse dependency order)
    const tablesToDrop = [
      'audit_logs',
      'error_logs', 
      'alerts',
      'monitoring_events',
      'checkout_attempts',
      'retailer_credentials',
      'skus',
      'users',
      'migrations'
    ];
    
    // Drop all tables
    for (const table of tablesToDrop) {
      try {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`Dropped table: ${table}`);
      } catch (err) {
        console.log(`Table ${table} didn't exist or couldn't be dropped: ${err.message}`);
      }
    }
    
    // Drop the update function
    try {
      await client.query('DROP FUNCTION IF EXISTS update_updated_at_column CASCADE');
      console.log('Dropped update_updated_at_column function');
    } catch (err) {
      console.log('Function update_updated_at_column didn\'t exist');
    }
    
    console.log('✅ Database reset complete - all tables dropped');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

resetDatabase();