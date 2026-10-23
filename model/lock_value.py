"""
Lock-In value model.

League rule (Sleeper Lock-In): each starter contributes ONE game per week. After a game you may lock it,
but only before that player's next game starts. If you never lock, his final game of the week counts.

Per-game score X = max(0, mu * (1 + cv * Z)), Z drawn from the pooled standardized residuals of 13,509
2025-26 games (right-skewed). cv comes from each player's own game log, shrunk toward the pool.

Weekly lock value with n games played and optimal stopping:
  W1 = E[X];  Wk = E[max(X, W(k-1))]
Season value = P(active that week) * E_n[ W_n ],  n ~ Binomial(team games that week, 1 - rest rate).
"""
import numpy as np

Z_Q = np.array([-3.564, -1.543, -1.245, -1.020, -0.845, -0.694, -0.546, -0.409, -0.279, -0.158, -0.040,
                0.088, 0.214, 0.351, 0.496, 0.649, 0.826, 1.016, 1.270, 1.661, 4.399])
U_Q = np.linspace(0, 1, len(Z_Q))
U_GRID = (np.arange(400) + 0.5) / 400
Z_GRID = np.interp(U_GRID, U_Q, Z_Q)
Z_GRID = (Z_GRID - Z_GRID.mean()) / Z_GRID.std()   # keep mean 0, sd 1 after interpolation

LOAD_MANAGED = {"LeBron James", "Kyrie Irving", "Kawhi Leonard", "Stephen Curry", "Kevin Durant",
                "James Harden", "Damian Lillard", "Jimmy Butler", "Paul George", "Chris Paul", "Russell Westbrook",
                "DeMar DeRozan", "CJ McCollum", "Jrue Holiday", "Mike Conley", "Al Horford"}


def shrunk_cv(n, mean, sd, pool_cv, rookie=False, k=15):
    if n and n >= 5 and mean and mean >= 6:
        obs = sd / mean
        return float((n * obs + k * pool_cv) / (n + k))
    return float(pool_cv + (0.03 if rookie else 0.0))


def w_table(mu, cv, nmax=5):
    """W_n for n = 0..nmax (W_0 = 0: player didn't play that week)."""
    x = np.maximum(0.0, mu * (1 + cv * Z_GRID))
    w = [0.0, float(x.mean())]
    for _ in range(2, nmax + 1):
        w.append(float(np.maximum(x, w[-1]).mean()))
    return w


def split_availability(a, name):
    """Season share of games -> (P(active in a given week), per-game rest rate while active)."""
    c = 0.4 if name in LOAD_MANAGED else 0.6      # share of missed games that come in multi-week blocks
    a_week = 1 - c * (1 - a)
    rest = max(0.0, 1 - a / a_week)
    return a_week, rest


def binom_pmf(g, p):
    from math import comb
    return [comb(g, k) * p ** k * (1 - p) ** (g - k) for k in range(g + 1)]


def lock_value(mu, cv, a, name, games_by_week, weeks):
    a_week, rest = split_availability(a, name)
    w = w_table(mu, cv, 5)
    vals = []
    for wk in weeks:
        g = games_by_week[wk - 1]
        if g <= 0:
            vals.append(0.0); continue
        pmf = binom_pmf(min(g, 5), 1 - rest)
        vals.append(a_week * sum(pmf[n] * w[n] for n in range(len(pmf))))
    return float(np.mean(vals)), w, a_week, rest
