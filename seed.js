#!/usr/bin/env node
// ÉLAN seed command.
//
//   node seed.js --content    the menu, tables, FAQ, offers and settings (safe on production, never overwrites edits)
//   node seed.js --admin      the owner account from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME (safe on production)
//   node seed.js --demo       content + labelled demo accounts + six weeks of sample orders, reviews, bookings and chats
//   node seed.js --demo --reset   remove the demo data (only that) and build it again
//   node seed.js --demo --dry-run  build the demo data in memory and print a summary; touches no database
//
// The demo accounts share a published password, so --demo and --reset refuse to run in production unless
// ALLOW_DEMO_SEED=true is set on purpose.
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { DEMO_PASSWORD, DEMO_STAFF, seedAdmin, seedDemoAccounts } from './seed/accounts.js';
import { seedContent } from './seed/content.js';
import { planDemoHistory, resetDemo, seedDemoHistory, summarisePlan } from './seed/history.js';
import { buildCatalogue } from './seed/history/catalogue.js';

const FLAGS = new Set(['demo', 'content', 'admin', 'reset', 'dry-run', 'help']);
const args = process.argv.slice(2).map((a) => a.replace(/^--/, ''));
const unknown = args.filter((a) => !FLAGS.has(a));
const has = (name) => args.includes(name);
const log = (line) => console.log(`  ${line}`);

function usage() {
  console.log(`
ÉLAN seed

  node seed.js --content          menu, tables, FAQ, offers and settings (safe on production)
  node seed.js --admin            the owner account from ADMIN_EMAIL / ADMIN_PASSWORD (safe on production)
  node seed.js --demo             content, demo accounts and six weeks of sample activity
  node seed.js --demo --reset     remove the demo data, then build it again
  node seed.js --demo --dry-run   build the demo data in memory and print a summary (no database)

Flags can be combined, for example: node seed.js --content --admin
`);
}

function printGuide({ plan, tables }) {
  const base = env.PUBLIC_CLIENT_URL.replace(/\/$/, '');
  const pendingOrder = plan.orders.find((o) => o.status === 'pending_payment');
  const pendingPayment = pendingOrder ? plan.payments.find((p) => p.order === pendingOrder._id) : null;
  const rider = plan.orders.find((o) => o.status === 'out_for_delivery');
  const kitchen = plan.orders.find((o) => o.status === 'preparing');
  const upcoming = plan.reservations.filter((r) => r.status === 'confirmed' && r.startsAt > new Date()).sort((a, b) => a.startsAt - b.startsAt)[0];
  const table = tables?.get ? [...tables.values()].find((t) => t.number === '4') : null;

  console.log('\nDemo ready. Sign in with the password below (it is public on purpose, so never use this on a real restaurant).\n');
  console.log(`  password   ${DEMO_PASSWORD}`);
  for (const person of DEMO_STAFF) console.log(`  ${person.role.padEnd(9)}  ${person.email}`);
  console.log('  customer   rahim@elan.demo (regular, Élite), maliha@elan.demo (new, no orders), imtiaz@elan.demo (has a saved cart)');
  console.log('\nLinks worth opening:');
  if (kitchen) console.log(`  A live order in the kitchen   ${base}/track-order/${kitchen.publicId}`);
  if (rider) console.log(`  An order out for delivery     ${base}/track-order/${rider.publicId}`);
  if (pendingPayment) console.log(`  A payment waiting (sandbox)   ${base}/payment/sandbox?session=${pendingPayment.sessionId}   (the sweeper cancels it after 30 minutes)`);
  if (upcoming) console.log(`  An upcoming reservation       ${base}/reservation/${upcoming.publicId}`);
  if (table) console.log(`  Table 4 QR ordering           ${base}/t/4?k=${table.qrToken}`);
  console.log(`  Staff screens                 ${base}/admin   ${base}/kitchen   ${base}/staff\n`);
}

async function main() {
  if (unknown.length) {
    console.error(`Unknown option: ${unknown.map((a) => `--${a}`).join(', ')}`);
    usage();
    process.exitCode = 1;
    return;
  }
  if (args.length === 0 || has('help')) {
    usage();
    return;
  }
  const demo = has('demo');
  const reset = has('reset');
  const dryRun = has('dry-run');
  if (reset && !demo) {
    console.error('--reset removes demo data, so it must be used together with --demo.');
    process.exitCode = 1;
    return;
  }
  if (dryRun && !demo) {
    console.error('--dry-run is for the demo data: use it as --demo --dry-run.');
    process.exitCode = 1;
    return;
  }
  if ((demo || reset) && env.isProd && !env.allowDemoSeed) {
    console.error('Refusing to add demo data to a production database. The demo accounts share a published password.');
    console.error('If you really mean it (for a public demo site, say), set ALLOW_DEMO_SEED=true and run again.');
    process.exitCode = 1;
    return;
  }

  const now = new Date();

  if (dryRun) {
    const catalogue = buildCatalogue({ now });
    const plan = planDemoHistory({
      now, restaurant: catalogue.restaurant, menu: catalogue.menu, tables: catalogue.tables, coupons: catalogue.coupons, staff: catalogue.staff,
      customers: catalogue.customers, ingredients: [...catalogue.ingredients.values()], supplierNames: new Map([...catalogue.suppliers.values()].map((s) => [String(s._id), s.name])),
      nextId: catalogue.nextId,
    });
    console.log('\nDry run: nothing was written. This is what --demo would add on top of the content:\n');
    console.log(JSON.stringify(summarisePlan(plan), null, 2));
    return;
  }

  console.log('\nÉLAN seed');
  await connectDb();
  try {
    if (reset) await resetDemo({ log });
    let content = null;
    if (has('content') || demo) content = await seedContent({ now, log });
    if (has('admin')) await seedAdmin({ log });
    if (demo) {
      const accounts = await seedDemoAccounts({ now, log });
      const result = await seedDemoHistory({ now, content, accounts, log });
      if (!result.skipped) {
        console.log('\n  Summary:', JSON.stringify(result.summary));
        printGuide(result);
      }
    }
    console.log('\nDone.\n');
  } finally {
    await disconnectDb().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err);
  process.exitCode = 1;
  disconnectDb().catch(() => {});
});
