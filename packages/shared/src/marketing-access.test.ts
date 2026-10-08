import { describe, expect, it } from 'vitest';
import { isMarketingMember, POS_MARKETING_CAP } from './marketing-access';

describe('isMarketingMember', () => {
  it('trusts Houzs when it answers yes', () => {
    expect(isMarketingMember({ capabilities: { [POS_MARKETING_CAP]: true }, positionName: 'Sales Executive' })).toBe(true);
  });

  it('trusts Houzs when it answers no, even with the marketing Title', () => {
    // The day Houzs answers, a title rename must not keep the behaviour alive.
    expect(isMarketingMember({ capabilities: { [POS_MARKETING_CAP]: false }, positionName: 'Sales Marketing' })).toBe(false);
  });

  it('falls back to the exact Title only while the capability is unanswered', () => {
    expect(isMarketingMember({ capabilities: {}, positionName: 'Sales Marketing' })).toBe(true);
    expect(isMarketingMember({ capabilities: {}, positionName: '  sales   MARKETING ' })).toBe(true);
    expect(isMarketingMember({ capabilities: {}, positionName: 'Sales Executive' })).toBe(false);
    expect(isMarketingMember({ positionName: null })).toBe(false);
  });

  it('reads the exact Title, never a word in it — a rename must not grant it', () => {
    for (const positionName of ['Marketing', 'Sales Marketing Intern', 'Sales & Marketing', 'Remarketingish']) {
      expect(isMarketingMember({ capabilities: {}, positionName }), positionName).toBe(false);
    }
  });

  it('applies the rest of Houzs\'s rule while unanswered: no director, no non-sales Title', () => {
    expect(isMarketingMember({ capabilities: { 'org.director': true }, positionName: 'Sales Marketing' })).toBe(false);
    expect(isMarketingMember({ capabilities: { 'org.sales.staff': false }, positionName: 'Sales Marketing' })).toBe(false);
    expect(isMarketingMember({ capabilities: { 'org.director': false, 'org.sales.staff': true }, positionName: 'Sales Marketing' })).toBe(true);
  });

  it('treats no facts as not marketing', () => {
    expect(isMarketingMember(null)).toBe(false);
    expect(isMarketingMember(undefined)).toBe(false);
  });
});
