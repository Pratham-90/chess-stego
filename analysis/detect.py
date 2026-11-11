"""Plot the feature distributions and train "real vs generated" detectors.

    python analysis/detect.py     (reads data/features.csv, writes plots/*.png and tables.md)

For each generated set we train two classifiers to tell its games apart from
real human games, and score them with 5-fold cross-validation: the games are
split into 5 parts, the model learns on 4 and is tested on the 5th, in turn.
Accuracy near 50% = cannot tell them apart. Near 100% = trivially detectable.
"""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # draw straight to files, no window needed
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent
PLOTS = HERE / "plots"

# set name -> (label, colour). Colours stay with their set in every plot.
SETS = {
    "real": ("Real (Lichess)", "#2a78d6"),
    "gen_uci": ("All legal moves", "#eb6834"),
    "gen_k2": ("Engine top-2", "#1baf7a"),
    "gen_k4": ("Engine top-4", "#eda100"),
    "gen_human": ("Human-matched", "#e87ba4"),  # optional stretch set
}
FEATURES = {
    "acpl": "Average centipawn loss",
    "blunder_rate": "Blunder rate (move loses 200+ cp)",
    "mistake_rate": "Mistake rate (move loses 100-200 cp)",
    "top1_rate": "Played the engine's best move",
    "top2_rate": "Played a top-2 engine move",
    "top3_rate": "Played a top-3 engine move",
    "plies": "Game length (half-moves)",
    "ends_checkmate": "Ends in checkmate",
    "ends_board_draw": "Ends in a forced draw",
}
MOVE_QUALITY = ["acpl", "blunder_rate", "mistake_rate", "top1_rate", "top2_rate", "top3_rate"]
FEATURE_GROUPS = {"all features": list(FEATURES), "move quality only": MOVE_QUALITY}

INK, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#e1e0d9", "#fcfcfb"
plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": "#c3c2b7", "axes.labelcolor": MUTED, "text.color": INK,
    "xtick.color": MUTED, "ytick.color": MUTED, "grid.color": GRID,
    "axes.spines.top": False, "axes.spines.right": False, "font.size": 9,
    "axes.titlesize": 10, "axes.titleweight": "bold", "axes.titlelocation": "left",
})


# ---------- plots ----------

def plot_boxes(frame: pd.DataFrame, names: list[str]) -> None:
    """One panel per feature; one horizontal box per set (middle 50% of games)."""
    features = [f for f in FEATURES if not f.startswith("ends_")]
    fig, axes = plt.subplots(4, 2, figsize=(10, 9.5))
    for ax, feature in zip(axes.flat, features):
        data = [frame.loc[frame["set"] == name, feature] for name in reversed(names)]
        boxes = ax.boxplot(data, vert=False, patch_artist=True, widths=0.55, whis=(5, 95),
                           showfliers=False, medianprops={"color": INK, "linewidth": 1.5},
                           whiskerprops={"color": MUTED}, capprops={"color": MUTED})
        for patch, name in zip(boxes["boxes"], reversed(names)):
            patch.set(facecolor=SETS[name][1], edgecolor=SURFACE, linewidth=1)
        ax.set_yticks(range(1, len(names) + 1), [SETS[name][0] for name in reversed(names)])
        ax.tick_params(axis="y", colors=INK, length=0)
        ax.set_title(FEATURES[feature])
        ax.grid(axis="x", linewidth=0.6)
        ax.set_axisbelow(True)
    for ax in axes.flat[len(features):]:
        ax.axis("off")
        ax.text(0, 0.9, "How to read: each box spans the middle 50% of games,\n"
                "the dark line is the median, and the whiskers cover\n"
                "5% to 95% of games.", va="top", color=MUTED, transform=ax.transAxes)
    fig.suptitle("Real vs generated games, feature by feature", x=0.02, ha="left",
                 fontsize=13, fontweight="bold")
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    fig.savefig(PLOTS / "feature_boxes.png", dpi=150)
    plt.close(fig)


def plot_histograms(frame: pd.DataFrame, names: list[str]) -> None:
    """Small multiples: a row per set, a column per feature, shared x-axes."""
    features = ["acpl", "top1_rate", "plies"]
    fig, axes = plt.subplots(len(names), len(features), sharex="col", squeeze=False,
                             figsize=(10, 1.6 * len(names) + 1))
    for col, feature in enumerate(features):
        low, high = frame[feature].min(), frame[feature].max()
        for row, name in enumerate(names):
            ax = axes[row][col]
            ax.hist(frame.loc[frame["set"] == name, feature], bins=30, range=(low, high),
                    color=SETS[name][1], rwidth=0.88)
            ax.set_yticks([])
            ax.spines["left"].set_visible(False)
            if col == 0:
                ax.set_ylabel(SETS[name][0], rotation=0, ha="right", va="center", color=INK)
            if row == 0:
                ax.set_title(FEATURES[feature])
    fig.suptitle("Distribution of three features (bar height = number of games, each panel scaled to its tallest bar)",
                 x=0.02, ha="left", fontsize=13, fontweight="bold")
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    fig.savefig(PLOTS / "feature_histograms.png", dpi=150)
    plt.close(fig)


def plot_detection(results: pd.DataFrame) -> None:
    """Best detector accuracy per generated set, for both feature groups."""
    best = results.groupby(["set", "features"], sort=False)["accuracy"].max().unstack()
    best = best[list(FEATURE_GROUPS)].iloc[::-1]
    colours = {"all features": "#2a78d6", "move quality only": "#eb6834"}
    fig, ax = plt.subplots(figsize=(8, 0.9 * len(best) + 1.6))
    height = 0.36
    for i, group in enumerate(FEATURE_GROUPS):
        ys = [y + (0.5 - i) * (height + 0.03) for y in range(len(best))]
        bars = ax.barh(ys, best[group] * 100, height=height, color=colours[group], label=group)
        ax.bar_label(bars, fmt="%.0f%%", padding=3, color=INK)
    ax.axvline(50, color=MUTED, linewidth=1, linestyle=(0, (4, 3)))
    ax.set_yticks(range(len(best)), [SETS[name][0] for name in best.index])
    ax.tick_params(axis="y", colors=INK, length=0)
    ax.set_xlim(0, 108)
    ax.set_xlabel("Detector accuracy, 5-fold cross-validation (dashed line: 50% = coin flip)")
    ax.set_title("How often a detector tells generated games from real ones")
    ax.grid(axis="x", linewidth=0.6)
    ax.set_axisbelow(True)
    fig.legend(frameon=False, loc="lower left", ncols=2)
    fig.tight_layout(rect=(0, 0.07, 1, 1))
    fig.savefig(PLOTS / "detector_accuracy.png", dpi=150)
    plt.close(fig)


# ---------- detector ----------

def detect(frame: pd.DataFrame, names: list[str]) -> pd.DataFrame:
    models = {
        # Logistic regression draws one straight boundary; scaling first puts
        # all features on a comparable footing.
        "logistic regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)),
        # A random forest is many decision trees voting; it can find
        # non-linear patterns such as "suspiciously few blunders".
        "random forest": RandomForestClassifier(n_estimators=200, random_state=0),
    }
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=0)
    rows = []
    for name in names[1:]:
        pair = frame[frame["set"].isin(["real", name])]
        labels = (pair["set"] != "real").astype(int)  # 1 = generated
        for group, columns in FEATURE_GROUPS.items():
            for model_name, model in models.items():
                scores = cross_validate(model, pair[columns], labels, cv=folds,
                                        scoring=["accuracy", "roc_auc"])
                rows.append({"set": name, "features": group, "model": model_name,
                             "accuracy": scores["test_accuracy"].mean(),
                             "roc_auc": scores["test_roc_auc"].mean()})
    return pd.DataFrame(rows)


def main() -> None:
    PLOTS.mkdir(exist_ok=True)
    frame = pd.read_csv(HERE / "data" / "features.csv")
    names = [name for name in SETS if name in set(frame["set"])]

    plot_boxes(frame, names)
    plot_histograms(frame, names)
    results = detect(frame, names)
    plot_detection(results)

    summary = frame.groupby("set")[list(FEATURES)].mean().loc[names].T
    summary.index = [FEATURES[f] for f in summary.index]
    summary.columns = [SETS[name][0] for name in names]
    shown = results.assign(set=results["set"].map(lambda name: SETS[name][0]),
                           accuracy=(results["accuracy"] * 100).map("{:.1f}%".format),
                           roc_auc=results["roc_auc"].map("{:.3f}".format))
    text = (f"## Average feature values ({frame.groupby('set').size().min()} games per set)\n\n"
            + summary.round(3).to_markdown()
            + "\n\n## Detector results (real vs each generated set)\n\n"
            + shown.to_markdown(index=False) + "\n")
    (HERE / "tables.md").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
