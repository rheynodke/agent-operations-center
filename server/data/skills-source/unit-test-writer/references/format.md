# Output Format — Test File Layout

## File location convention

| Stack | Test file path |
|---|---|
| Odoo | `{module}/tests/test_{model}.py` |
| React | `__tests__/{Component}.test.tsx` (default) atau co-located |
| Vue | `tests/unit/{component}.test.ts` |
| Express | `src/services/{service}.test.ts` (co-located) |
| FastAPI | `app/tests/test_{module}.py` |

## Naming convention (strict)

Format: `test_{what}_when_{condition}_then_{expected}` (Python) atau Vitest-equivalent:
`it('does {what} when {condition} returns {expected}', ...)`

Examples:
- ✅ `test_create_discount_with_negative_value_then_raises_validation_error`
- ✅ `it('shows empty state when no items in cart')`
- ❌ `test_1`, `test_create`, `test_works`

## Structure per test (AAA: Arrange-Act-Assert)

```python
def test_create_discount_with_percent_then_amount_computed():
    # Arrange
    order = self.env['sale.order'].create({...})

    # Act
    line = self.env['sale.order.discount.line'].create({
        'order_id': order.id, 'type': 'percent', 'value': 10.0,
    })

    # Assert
    self.assertEqual(line.amount, expected_amount)
```

```typescript
it('shows error on invalid code', async () => {
  // Arrange
  vi.mocked(applyDiscount).mockRejectedValue({ code: 'INVALID' });

  // Act
  render(<DiscountSection />);
  fireEvent.click(screen.getByText(/apply/i));

  // Assert
  await waitFor(() => {
    expect(screen.getByText(/kode tidak valid/i)).toBeInTheDocument();
  });
});
```

## Required test cases per public function

Minimum 3:
1. **Happy path** — typical valid usage
2. **Edge case** — boundary value (empty, max, unicode, etc.)
3. **Error path** — invalid input or expected exception

Plus stack-specific recommendations:
- Odoo: multi-record operations, security (per group), translation context
- React/Vue: loading/error/empty states, user interactions
- Express/FastAPI: auth variations, validation rejection, async error

## Coverage commands

| Stack | Command |
|---|---|
| Odoo | `coverage run --source={module} odoo-bin --test-tags=/{module} -d test_db --stop-after-init && coverage report --fail-under=80` |
| React/Vue/Express | `vitest run --coverage --coverage.thresholds.lines=80` |
| FastAPI | `pytest --cov=app --cov-report=term-missing --cov-fail-under=80` |

## Coverage gate

≥80% line coverage on new code (delta from main branch).

`coverage.py` for Python: gate via `--fail-under=80`
Vitest: `coverage.thresholds.lines: 80` di config

## Anti-pattern

- ❌ Generic test names (`test_1`, `test_create`)
- ❌ Test private (underscore-prefixed) methods directly
- ❌ Mock setup > 50% of test body
- ❌ Multiple unrelated assertions in one test
- ❌ `xit`/`skip` tanpa ticket reference
- ❌ Order-dependent tests (parallel-unsafe)
- ❌ Coverage gaming (test trivial getters/setters)
- ❌ Flaky test ignored (retry instead of investigate)
- ❌ Shared mutable fixture state across tests
