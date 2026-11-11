## Average feature values (300 games per set)

|                                      |   Real (Lichess) |   All legal moves |   Engine top-2 |   Engine top-4 |   Human-matched |
|:-------------------------------------|-----------------:|------------------:|---------------:|---------------:|----------------:|
| Average centipawn loss               |           81.054 |           434.261 |         58.541 |         91.762 |         112.048 |
| Blunder rate (move loses 200+ cp)    |            0.101 |             0.563 |          0.061 |          0.126 |           0.156 |
| Mistake rate (move loses 100-200 cp) |            0.134 |             0.13  |          0.115 |          0.144 |           0.16  |
| Played the engine's best move        |            0.351 |             0.057 |          0.339 |          0.23  |           0.26  |
| Played a top-2 engine move           |            0.522 |             0.111 |          0.58  |          0.414 |           0.432 |
| Played a top-3 engine move           |            0.625 |             0.159 |          0.712 |          0.565 |           0.555 |
| Game length (half-moves)             |           76.21  |           191.417 |        125.277 |        121.54  |          70.113 |
| Ends in checkmate                    |            0.297 |             0.113 |          0.867 |          0.863 |           0.22  |
| Ends in a forced draw                |            0.033 |             0.013 |          0     |          0.003 |           0     |

## Detector results (real vs each generated set)

| set             | features          | model               | accuracy   |   roc_auc |
|:----------------|:------------------|:--------------------|:-----------|----------:|
| All legal moves | all features      | logistic regression | 100.0%     |     1     |
| All legal moves | all features      | random forest       | 99.8%      |     1     |
| All legal moves | move quality only | logistic regression | 99.8%      |     1     |
| All legal moves | move quality only | random forest       | 99.8%      |     1     |
| Engine top-2    | all features      | logistic regression | 93.5%      |     0.989 |
| Engine top-2    | all features      | random forest       | 94.0%      |     0.986 |
| Engine top-2    | move quality only | logistic regression | 86.2%      |     0.932 |
| Engine top-2    | move quality only | random forest       | 84.7%      |     0.924 |
| Engine top-4    | all features      | logistic regression | 94.0%      |     0.983 |
| Engine top-4    | all features      | random forest       | 93.7%      |     0.977 |
| Engine top-4    | move quality only | logistic regression | 86.8%      |     0.94  |
| Engine top-4    | move quality only | random forest       | 86.5%      |     0.927 |
| Human-matched   | all features      | logistic regression | 76.8%      |     0.848 |
| Human-matched   | all features      | random forest       | 75.5%      |     0.831 |
| Human-matched   | move quality only | logistic regression | 76.7%      |     0.847 |
| Human-matched   | move quality only | random forest       | 75.7%      |     0.826 |
