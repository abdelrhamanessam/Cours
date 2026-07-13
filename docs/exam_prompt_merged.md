# AI Prompt — Generate Exam Questions

Generate exam questions in **two formats** per question.

---

## Format 1 — Markdown (for display)

```
**(N)** Question text with $all math in dollars$

**Solution:**
∵ Step one in $math$ ∴ Step two in $math$
∵ Step three in $math$ ∴ Step four in $math$

**Choose:** (a) $value$ &emsp; (b) $value$ &emsp; (c) $value$ &emsp; (d) $value$

**Answer:** a
```

### Rules
- **ALL** math symbols, numbers, variables, sets ($\mathbb{R}$), functions → `$...$`
- Use `∵` and `∴` to separate steps, **max 2 per line**
- Write **Solution:** before solution
- Options in one line with `&emsp;` between them (two lines if very long)
- Final answer as single letter: `a`

---

## Format 2 — Word (for import)

```
{N}. {question text}
{* or ✓}{letter}. {option}
{letter}. {option}
{letter}. {option}
{letter}. {option}
```

### Rules
- Number + period + space: `1.` `2.`
- Letter + period + space: `a.` `b.` `c.` `d.`
- Correct answer: `*` or `✓` **immediately before** the letter (e.g. `*c. 5` or `✓ b. 3`)
- Each option on its **own line**
- No extra spaces or blank lines between options
- Blank line between questions

---

## Full Example

**(1)** If $e^{xy} - x^{2} + y^{3} = 0$, then $\dfrac{dy}{dx} = \cdots$ at $x = 0$

**Solution:**
∵ $e^{xy} - x^{2} + y^{3} = 0$ and at $x = 0$: $e^{0} + y^{3} = 0$ ∴ $y = -1$
∵ $e^{xy}(y + x\dfrac{dy}{dx}) - 2x + 3y^{2}\dfrac{dy}{dx} = 0$
∴ At $x = 0$, $y = -1$: $-1 + 3\dfrac{dy}{dx} = 0$ ∴ $\dfrac{dy}{dx} = \dfrac{1}{3}$

**Choose:** (a) $-1$ &emsp; (b) $-\dfrac{1}{3}$ &emsp; (c) $1$ &emsp; (d) $\dfrac{1}{3}$

**Answer:** d

```
1. If e^(xy) - x² + y³ = 0, then dy/dx = ............ at x = 0
a. -1
b. -1/3
c. 1
*d. 1/3
```

---

## Important Notes
- Every numeric value, variable, function name, operator in Format 1 MUST be inside `$...$`
- In Format 2, do NOT use dollar signs — plain text only with `^` for powers
- Correct answer marker (`*` or `✓`) goes **before** the letter, not after
- The Word block starts with the number and ends after the last option, with a blank line before the next question
