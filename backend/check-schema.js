import pkg from 'pg';
const { Pool } = pkg;

const db = new Pool({
  connectionString: process.env.DATABASE_URL
});

try {
  const result = await db.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns 
    WHERE table_name = 'skus' 
    ORDER BY ordinal_position
  `);
  
  console.log('SKUs table columns:');
  result.rows.forEach(r => {
    console.log(`  ${r.column_name.padEnd(30)} ${r.data_type.padEnd(20)} ${r.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
  });
  
  // Also check some sample data
  console.log('\nSample data:');
  const data = await db.query(`
    SELECT id, retailer, product_id, product_url, product_name, monitoring_status
    FROM skus 
    LIMIT 2
  `);
  data.rows.forEach(r => {
    console.log(`  ${r.id}: ${r.retailer} - ${r.product_id} - ${r.product_url ? 'HAS URL' : 'NULL URL'}`);
  });
} finally {
  await db.end();
}
