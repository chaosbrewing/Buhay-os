import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, fractionDigits, moneyInputValue, parseMoney } from './tuklas-format.ts';

test('currencies know their decimal places', () => {
  assert.equal(fractionDigits('AUD'), 2);
  assert.equal(fractionDigits('JPY'), 0);
});

test('typed amounts become whole minor units exactly', () => {
  assert.equal(parseMoney('12', 'AUD'), 1200);
  assert.equal(parseMoney('12.5', 'AUD'), 1250);
  assert.equal(parseMoney('$1,234.50', 'AUD'), 123450);
  assert.equal(parseMoney(' 0.07 ', 'USD'), 7);
  assert.equal(parseMoney('19.99', 'AUD'), 1999);
  assert.equal(parseMoney('500', 'JPY'), 500);
});

test('anything that is not a plain positive amount is refused, never rounded', () => {
  for (const bad of ['', 'abc', '-5', '0', '0.00', '1.234', '1.2.3', '12,5,0.0x', '1e3', '9'.repeat(20)]) {
    assert.equal(parseMoney(bad, 'AUD'), null, bad);
  }
  assert.equal(parseMoney('1.5', 'JPY'), null);
});

test('amounts are shown with the right decimals and typed back the same way', () => {
  assert.match(formatMoney(284000, 'USD'), /2,840\.00/);
  assert.match(formatMoney(500, 'JPY'), /500/);
  assert.equal(moneyInputValue(123450, 'AUD'), '1234.50');
  assert.equal(moneyInputValue(500, 'JPY'), '500');
  assert.equal(parseMoney(moneyInputValue(1999, 'AUD'), 'AUD'), 1999);
});
