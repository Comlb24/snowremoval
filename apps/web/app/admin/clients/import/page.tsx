import { CSV_TEMPLATE } from '@snow/core';
import { requirePageRole } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { ImportForm } from './import-form';

export default async function ImportPage() {
  await requirePageRole('admin');
  return (
    <>
      <PageHeader title="Import clients from CSV" sub="Upload a file, check the preview, then import the valid rows. Rows with the same name and phone become one client with several properties." />
      <ImportForm template={CSV_TEMPLATE} />
    </>
  );
}
