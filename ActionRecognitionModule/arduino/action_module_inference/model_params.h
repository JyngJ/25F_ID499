#pragma once

/**
 * Placeholder model parameters. Run python/train_model.py after collecting
 * data to overwrite this file with real weights.
 */

#include <Arduino.h>

namespace ActionModuleModel {

constexpr size_t kFeatureCount = 7;
constexpr size_t kClassCount = 4;

static const float kFeatureMean[kFeatureCount] = {0.f, 0.f, 0.f, 0.f, 0.f, 0.f, 0.f};
static const float kFeatureScale[kFeatureCount] = {1.f, 1.f, 1.f, 1.f, 1.f, 1.f, 1.f};

static const float kWeights[kClassCount][kFeatureCount] = {
    {0.f, 0.f, 0.f, 0.f, 0.f, 0.f, 0.f},
    {0.f, 0.f, 0.f, 0.f, 0.f, 0.f, 0.f},
    {0.f, 0.f, 0.f, 0.f, 0.f, 0.f, 0.f},
    {0.f, 0.f, 0.f, 0.f, 0.f, 0.f, 0.f},
};

static const float kBias[kClassCount] = {0.f, 0.f, 0.f, 0.f};
static const char* const kClassLabels[kClassCount] = {"tap", "rest_head", "hug", "shake"};

inline void standardizeFeatures(const float raw[], float standardized[]) {
  for (size_t i = 0; i < kFeatureCount; ++i) {
    standardized[i] = (raw[i] - kFeatureMean[i]) / kFeatureScale[i];
  }
}

inline int predict(const float features[]) {
  float standardized[kFeatureCount];
  standardizeFeatures(features, standardized);

  int best_index = 0;
  float best_logit = -1e9;

  for (size_t cls = 0; cls < kClassCount; ++cls) {
    float logit = kBias[cls];
    for (size_t feat = 0; feat < kFeatureCount; ++feat) {
      logit += kWeights[cls][feat] * standardized[feat];
    }
    if (logit > best_logit) {
      best_logit = logit;
      best_index = static_cast<int>(cls);
    }
  }
  return best_index;
}

inline const char* labelFromIndex(int idx) {
  if (idx < 0 || idx >= static_cast<int>(kClassCount)) {
    return "unknown";
  }
  return kClassLabels[idx];
}

}  // namespace ActionModuleModel
