import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SofaComboRule } from '../../lib/products/sofa-combos-queries';
import type { ProductModelRow } from '../../lib/products/product-models-queries';
import type { PwpRuleRow } from '../../lib/products/pwp-queries';
import { ACCESSORY_COMBO_TARGET_NOTICE, hasUnsupportedComboTargets } from '../../lib/sofa-combo-rule-support';

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}),
  rules: [] as PwpRuleRow[],
  combos: [
    { id: 'bare', baseModel: 'SOFA1', label: 'Sofa only', modules: [['2NA']] },
    { id: 'inclusive', baseModel: 'SOFA1', label: 'With cushions', modules: [['2NA']], accessories: [{ modelId: 'cushion', qty: 2 }] },
  ] as SofaComboRule[],
}));

vi.mock('../../lib/products/sofa-combos-queries', () => ({ useSofaCombos: () => ({ data: mocks.combos, isLoading: false }) }));
vi.mock('../../lib/products/product-models-queries', () => ({ useProductModels: () => ({ data: [], isLoading: false }) }));
vi.mock('../../lib/products/pwp-queries', () => ({
  usePwpRules: () => ({ data: mocks.rules }),
  useCreatePwpRule: () => ({ mutateAsync: mocks.create }),
  useUpdatePwpRule: () => ({ mutateAsync: mocks.update }),
  useDeletePwpRule: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../lib/products/mfg-products-queries', () => ({ useMfgProducts: () => ({ data: [] }) }));
vi.mock('../../lib/queries', () => ({
  POS_PICKABLE_SIZE_CODES: new Set(['Q', 'K', 'S', 'SS']),
  useModelDefaultGifts: () => ({ data: [] }),
  useUpsertModelDefaultGifts: () => ({}), useDeleteModelDefaultGifts: () => ({}),
}));
vi.mock('./FreeItemCampaignSection', () => ({ FreeItemCampaignSection: () => null }));

import { PwpRulesTab } from './PwpRulesTab';
import { RuleTargetRefinement } from './RuleTargetPicker';

afterEach(cleanup);
beforeEach(() => { mocks.rules = []; vi.clearAllMocks(); });

describe('sofa accessory combo offer selectors', () => {
  it('excludes inclusive trigger combos while preserving inclusive rewards', () => {
    render(<PwpRulesTab mode="full" />);
    fireEvent.click(screen.getByRole('button', { name: 'New PWP' }));
    const trigger = within(screen.getByText('1 · Trigger — what unlocks the offer').parentElement!);
    fireEvent.click(trigger.getByRole('button', { name: 'Sofa' }));
    expect(trigger.queryByRole('button', { name: /With cushions/ })).not.toBeInTheDocument();
    expect(trigger.getByText(ACCESSORY_COMBO_TARGET_NOTICE)).toBeInTheDocument();
    fireEvent.click(trigger.getByRole('button', { name: /Sofa only/ }));

    const reward = within(screen.getByText('2 · Reward — redeemable at PWP price').parentElement!);
    fireEvent.click(reward.getByRole('button', { name: 'Sofa' }));
    fireEvent.click(reward.getByRole('button', { name: /With cushions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ triggerComboIds: ['bare'], rewardComboIds: ['inclusive'] }));
  });

  it('blocks saving a previously selected inclusive trigger and lets staff remove it', () => {
    mocks.rules = [{ id: 'rule', type: 'pwp', triggerCategory: 'SOFA', triggerComboIds: ['inclusive'],
      triggerEligibleModelIds: [], rewardCategory: 'SOFA', rewardComboIds: ['bare'], eligibleRewardModelIds: [],
      triggerSizeCodes: [], triggerCompartments: [], rewardSizeCodes: [], rewardCompartments: [],
      qtyPerTrigger: 1, active: true, createdAt: '', updatedAt: '' }];
    render(<PwpRulesTab mode="full" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('alert')).toHaveTextContent(ACCESSORY_COMBO_TARGET_NOTICE);
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Remove .*With cushions/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /Sofa only/ })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ triggerComboIds: ['bare'] }));
  });

  it('offers only module-only combos for gift, free-item and delivery refinements', () => {
    const change = vi.fn();
    render(<RuleTargetRefinement category="SOFA" model={{ allowed_options: {} } as ProductModelRow}
      combos={mocks.combos} value={{ scope: 'combo', comboIds: [] }} onChange={change} />);
    expect(screen.queryByRole('button', { name: 'With cushions' })).not.toBeInTheDocument();
    expect(screen.getByText(ACCESSORY_COMBO_TARGET_NOTICE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sofa only' }));
    expect(change).toHaveBeenCalledWith({ scope: 'combo', comboIds: ['bare'] });
    expect(hasUnsupportedComboTargets([{ scope: 'combo', comboIds: ['inclusive'] }], mocks.combos)).toBe(true);
    expect(hasUnsupportedComboTargets([{ scope: 'combo', comboIds: ['bare'] }, { scope: 'model' }], mocks.combos)).toBe(false);
  });
});
