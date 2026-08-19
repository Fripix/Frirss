import { describe, it, expect } from 'vitest';
import {
  actionKey, mergeAction, isNetworkFailure, shouldRetry, MAX_ATTEMPTS,
  type QueuedAction,
} from './actionQueue';

const act = (over: Partial<QueuedAction> = {}): QueuedAction => ({
  key: actionKey(over.articleId ?? 'a1', over.type ?? 'read', over.labelId),
  articleId: 'a1', type: 'read', value: true, at: 1, attempts: 0, ...over,
});

describe('actionKey', () => {
  it('separates the action types of one article', () => {
    expect(actionKey('a1', 'read')).not.toBe(actionKey('a1', 'star'));
  });
  it('separates two labels on the same article', () => {
    expect(actionKey('a1', 'label', 'l1')).not.toBe(actionKey('a1', 'label', 'l2'));
  });
});

describe('mergeAction', () => {
  it('adds an action to an empty queue', () => {
    expect(mergeAction([], act()).length).toBe(1);
  });

  it('collapses repeated toggles of the same article into the final state', () => {
    let q = mergeAction([], act({ value: true, at: 1 }));
    q = mergeAction(q, act({ value: false, at: 2 }));
    q = mergeAction(q, act({ value: true, at: 3 }));
    expect(q).toHaveLength(1);
    expect(q[0].value).toBe(true);
    expect(q[0].at).toBe(3);
  });

  it('resets the attempts when an action is superseded', () => {
    const q = mergeAction([act({ attempts: 2 })], act({ value: false, at: 5 }));
    expect(q[0].attempts).toBe(0);
  });

  it('keeps different action types side by side', () => {
    let q = mergeAction([], act({ type: 'read' }));
    q = mergeAction(q, act({ type: 'star', key: actionKey('a1', 'star') }));
    expect(q).toHaveLength(2);
  });

  it('keeps different articles side by side', () => {
    let q = mergeAction([], act({ articleId: 'a1' }));
    q = mergeAction(q, act({ articleId: 'a2', key: actionKey('a2', 'read') }));
    expect(q).toHaveLength(2);
  });

  it('preserves queue order, replacing in place', () => {
    let q = mergeAction([], act({ articleId: 'a1' }));
    q = mergeAction(q, act({ articleId: 'a2', key: actionKey('a2', 'read') }));
    q = mergeAction(q, act({ articleId: 'a1', value: false, at: 9 }));
    expect(q.map((a) => a.articleId)).toEqual(['a1', 'a2']);
    expect(q[0].value).toBe(false);
  });

  it('does not mutate the queue it is given', () => {
    const original = [act()];
    const copy = [...original];
    mergeAction(original, act({ articleId: 'a2', key: actionKey('a2', 'read') }));
    expect(original).toEqual(copy);
  });
});

describe('isNetworkFailure', () => {
  it('treats an axios error without a response as a network failure', () => {
    expect(isNetworkFailure({ message: 'Network Error', code: 'ERR_NETWORK' })).toBe(true);
  });
  it('treats a plain TypeError as a network failure', () => {
    expect(isNetworkFailure(new TypeError('Load failed'))).toBe(true);
  });
  it('does NOT queue a server refusal', () => {
    expect(isNetworkFailure({ response: { status: 403 } })).toBe(false);
    expect(isNetworkFailure({ response: { status: 400 } })).toBe(false);
  });
  it('treats a server error as a network-ish failure worth retrying', () => {
    expect(isNetworkFailure({ response: { status: 502 } })).toBe(true);
  });
  it('handles null', () => {
    expect(isNetworkFailure(null)).toBe(true);
  });
});

describe('shouldRetry', () => {
  it('retries below the limit', () => {
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(MAX_ATTEMPTS - 1)).toBe(true);
  });
  it('gives up at the limit', () => {
    expect(shouldRetry(MAX_ATTEMPTS)).toBe(false);
  });
});
