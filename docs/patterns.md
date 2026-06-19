# JENA Trigger Patterns

JENA trigger text can be either literal text or a regular expression.

When a trigger matcher is not marked as a regular expression, JENA treats the
entire matcher as literal text. Regular expression metacharacters and
GINA-style brace variables are escaped and matched exactly.

When a trigger matcher is marked as a regular expression, JENA supports the
GINA/EQLogParser-style brace variables below.

## Pattern Variables

`{C}` captures a possible character name. JENA always compiles this as a
generic character-name capture, then verifies after a match that the captured
name matches the character whose log file produced the line. The comparison is
case-insensitive.

`{S}` captures any non-empty string. `{S0}` through `{S9}` capture additional
named string values. These can be referenced in output text as `{S}`, `{S1}`,
`${S}`, or `${S1}`.

`{N}` captures a number. `{N0}` through `{N9}` capture additional named numeric
values. These can be referenced in output text as `{N}`, `{N1}`, `${N}`, or
`${N1}`.

Numeric bounds are validated after the regex match. JENA compiles the numeric
part as a number capture and rejects the match if the bound check fails.

Examples:

```text
{N>=50}
{N<123}
{100<=N<200}
{N==0|N>=100}
```

`{TS}` captures a timer duration in a compact time format such as `45`,
`01:30`, `1h:20m`, or `1h:20m:30s`.

## Output Variables

Display text, text-to-speech text, and timer names can reference captured
values using brace syntax:

```text
{C}
{S}
{S1}
{N}
{N1}
${S1}
```

JENA also supports C#-style regular expression replacement references:

```text
$1
$2
{1}
{2}
${1}
${2}
${name}
$$
```

`$1`, `$2`, `{1}`, `{2}`, `${1}`, and `${2}` refer to user-authored
positional regex captures. Generated internal captures for GINA-style variables
are not exposed as positional captures.

`${name}` refers to a user-authored named regex capture. Plain `{name}` does
not refer to a user-authored named regex capture because that would conflict
with GINA/EQLogParser variables such as `{S}` and `{N}`.

`$$` emits a literal dollar sign.

The shorthand `$S`, `$S1`, `$N`, and `$C` is not supported.

## Built-In Output Variables

`{L}` is replaced with the full log line text, without the log timestamp.

`{LOGTIME}` is replaced with the time from the EverQuest log timestamp when it
is available.

`{Z}` is replaced with the current zone for the character whose log line matched
the trigger, using JENA's local character presence. `{Z}` is output-only; it is
not supported as trigger match syntax.

`{COUNTER}` is replaced with the number of times the trigger has fired during
the current application session.

`{REPEATED}` currently uses the same session count as `{COUNTER}`. JENA does
not yet model EQLogParser's repeated reset-time behavior.

`{TIMER-WARN-TIME-VALUE}` is replaced with the trigger's configured timer
warning seconds when the trigger has a timer.

`{NULL}` suppresses the output field when it is the entire field value. When it
appears inside a longer field, it is replaced with an empty string.

## Output Modifiers

Output variables can use these modifiers:

```text
{S1.capitalize}
{S1.lower}
{S1.upper}
{N.number}
{S1.padleft:20}
{S1.padright:20}
{S1.center:20}
```

Modifiers affect output fields only. They are not pattern syntax.
