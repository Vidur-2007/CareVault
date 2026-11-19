import { describe, expect, it } from 'vitest';
import {
  answerSentence,
  compactVisitLine,
  greeting,
  numberWord,
  passportReadySentence,
  phoneSubline,
  phoneTitle,
  shortDoctorName,
  visitWhen,
} from './copy';

const ramesh = { name: 'Ramesh Iyer', relation: 'Father' };
const rao = { visit: { at: '2026-11-18T10:30:00+05:30' }, prescriber: { name: 'Dr. Kavita Rao', specialty: 'Cardiology' } };
const TODAY = '2026-11-14';

describe('review copy', () => {
  it('matches the desktop mockup sentence', () => {
    expect(answerSentence(3, ramesh, rao, TODAY)).toBe("Three things need your answer before your father's cardiology visit on Wednesday.");
  });

  it('handles one item, no visit and nothing to answer', () => {
    expect(answerSentence(1, ramesh, rao, TODAY)).toBe("One thing needs your answer before your father's cardiology visit on Wednesday.");
    expect(answerSentence(2, ramesh, null, TODAY)).toBe('Two things need your answer.');
    expect(answerSentence(0, ramesh, null, TODAY)).toBe('Nothing needs your answer right now.');
    expect(answerSentence(2, { name: 'Ramesh Iyer', relation: '' }, rao, TODAY)).toContain("before Ramesh's cardiology visit");
  });

  it('says when the visit is', () => {
    expect(visitWhen('2026-11-14T18:00:00+05:30', TODAY)).toBe('today');
    expect(visitWhen('2026-11-15T09:00:00+05:30', TODAY)).toBe('tomorrow');
    expect(visitWhen('2026-11-18T10:30:00+05:30', TODAY)).toBe('on Wednesday');
    expect(visitWhen('2026-12-02T10:30:00+05:30', TODAY)).toBe('on 2 December');
  });

  it('matches the phone mockup', () => {
    expect(phoneTitle(3)).toBe('3 things to review');
    expect(phoneTitle(1)).toBe('1 thing to review');
    expect(phoneSubline(rao, TODAY)).toBe('Before the cardiology visit on Wednesday.');
    expect(compactVisitLine(rao)).toBe('Wed 18 Nov, 10:30 am · Dr. Rao');
  });

  it('small helpers', () => {
    expect(numberWord(3, false)).toBe('three');
    expect(numberWord(12)).toBe('12');
    expect(greeting(9)).toBe('Good morning');
    expect(greeting(14)).toBe('Good afternoon');
    expect(greeting(20)).toBe('Good evening');
    expect(shortDoctorName('Dr. Suresh Menon')).toBe('Dr. Menon');
    expect(passportReadySentence(3)).toBe('The visit passport is ready once the three review items are answered.');
  });
});
