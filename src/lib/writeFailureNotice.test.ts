import { describe, it, expect } from 'vitest';
import { writeFailureNotice } from './writeFailureNotice';

describe('writeFailureNotice', () => {
  it('annonce le refus : la ligne est revenue, il faut dire pourquoi', () => {
    expect(writeFailureNotice({ networkFailure: false, online: true })).toBe('refused');
    // Un refus reste un refus même si le navigateur se dit hors ligne :
    // le serveur a répondu, donc il y avait bien un réseau.
    expect(writeFailureNotice({ networkFailure: false, online: false })).toBe('refused');
  });

  it('annonce la mise en file quand le navigateur est en ligne', () => {
    // Le cas trompeur : la ligne RESTE partie alors que rien n'a été écrit.
    // Un 5xx, ou une requête sans réponse alors que le réseau est là, n'est pas
    // une situation hors ligne — l'utilisateur doit l'apprendre.
    expect(writeFailureNotice({ networkFailure: true, online: true })).toBe('queued');
  });

  it('se tait quand le navigateur est vraiment hors ligne', () => {
    // Le bandeau hors-ligne global dit déjà tout ; un toast par clic ne serait
    // que du bruit pendant une session de lecture sans réseau.
    expect(writeFailureNotice({ networkFailure: true, online: false })).toBe(null);
  });
});
