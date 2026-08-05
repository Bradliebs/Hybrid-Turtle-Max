import { restoreDatabase } from '../src/lib/db-backup';

const backupFilename = process.argv[2];
if (!backupFilename) {
  console.error('Usage: npx tsx scripts/restore-database.ts <backup-filename>');
  process.exitCode = 1;
} else {
  const result = await restoreDatabase(backupFilename, { maintenanceMode: true });
  if (!result.success) {
    console.error(`Restore failed: ${result.error}`);
    process.exitCode = 1;
  } else {
    console.log(`Restored from: ${result.restoredFrom}`);
    console.log(`Pre-restore backup: ${result.preRestoreBackup ?? 'none'}`);
  }
}