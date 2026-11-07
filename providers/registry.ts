// Docs: docs/04 - Architecture/Provider Modules.md
// Purpose: the list of providers. To add a service, add its factory here.
import type { Provider, ProviderContext } from '@/sdk/types';
import type { Endpoints } from '@/core/catalog';
import { jellyfin } from './jellyfin';
import { netflix } from './netflix';

export type ContextFor = (id: string) => ProviderContext;

export function createProviders(ctxFor: ContextFor, endpoints: () => Endpoints): Provider[] {
  return [netflix(ctxFor('netflix'), endpoints), jellyfin(ctxFor('jellyfin'))];
}
