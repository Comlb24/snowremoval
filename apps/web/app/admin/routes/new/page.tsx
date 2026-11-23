import { config, driverOptions, listActiveProperties } from '@snow/server';
import { localDate, addMinutes } from '@snow/core';
import { requirePageRole } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { RouteBuilder } from './route-builder';

export default async function NewRoutePage() {
  const user = await requirePageRole('admin');
  const c = config();
  const [drivers, properties] = await Promise.all([driverOptions(user), listActiveProperties(user)]);
  return (
    <>
      <PageHeader title="New route" sub="Pick the day, driver and properties. We suggest an efficient order; you can change it on the next screen before publishing." />
      <RouteBuilder
        drivers={drivers}
        properties={properties.map((p: any) => ({ id: p.id, address: p.address, clientName: p.client_name, minutes: p.service_minutes, optedOut: p.opted_out }))}
        defaults={{ date: localDate(addMinutes(new Date(), 12 * 60), c.timeZone), time: '07:00', start: c.defaultStart }}
        simulatedRouting={c.routingMode === 'mock'}
      />
    </>
  );
}
