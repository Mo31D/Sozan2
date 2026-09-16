# Sozan2 interface redesign

Goal: keep the Sozan2 architecture, accounts, sync and modular internals while restoring the clarity of Sozan1 for daily use.

User-facing navigation:
- اليوم
- جدولي
- فلوسي
- طلابي
- أنا

Rules:
- Arabic-first UI; no architecture terminology in normal screens.
- Modules remain internal implementation details.
- Local/cloud status appears only as simple sync status.
- Daily actions should be reachable in one or two taps.
- Mobile-first RTL layout with safe fixed bottom navigation.
