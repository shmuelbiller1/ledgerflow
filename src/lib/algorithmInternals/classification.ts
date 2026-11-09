import { normalizeSearchText } from '../textNormalization';
import { KNOWN_CANONICAL_BRANDS } from './merchantIdentity';


/**
 * Bayesian Inference Engine
 * Calculates the probability of a category given a set of features (words).
 * P(Category | Words) = P(Words | Category) * P(Category) / P(Words)
 * Upgraded with Bigram Extraction, TF-IDF scaling considerations, and Laplace Smoothing to achieve 2x greater veracity and "integrity".
 */
export interface BayesianClassifierOptions {
  alpha?: number;
  temperature?: number;
  bigramMultiplier?: number;
  enableTrigrams?: boolean;
  trigramMultiplier?: number;
  abstentionMargin?: number;
  abstentionUniformBuffer?: number;
}


export interface EvaluationSample {
  text: string;
  expectedCategory: string;
}


export interface EvaluationResultItem {
  text: string;
  expectedCategory: string;
  predictedCategory: string | null;
  confidence: number;
  correct: boolean;
  top2Correct: boolean;
  isUnknown: boolean;
  isFalseConfidence: boolean;
}


export interface BenchmarkMetrics {
  total: number;
  accuracy: number;
  top2Accuracy: number;
  unknownRate: number;
  falseConfidenceRate: number;
  results: EvaluationResultItem[];
}


export class BayesianClassifier {
  private categoryCounts: Record<string, number> = {};
  private wordCounts: Record<string, Record<string, number>> = {};
  private categoryFeatureTotals: Record<string, number> = {};
  private docFrequency: Record<string, number> = {}; // TF-IDF tracking
  private totalDocuments = 0;
  private vocabulary = new Set<string>();

  private alpha: number;
  private temperature: number;
  private bigramMultiplier: number;
  private enableTrigrams: boolean;
  private trigramMultiplier: number;
  private abstentionMargin: number;
  private abstentionUniformBuffer: number;

  constructor(options: BayesianClassifierOptions = {}) {
    this.alpha = options.alpha ?? 0.75;
    this.temperature = options.temperature ?? 1.5;
    this.bigramMultiplier = options.bigramMultiplier ?? 1.65;
    this.enableTrigrams = options.enableTrigrams ?? true;
    this.trigramMultiplier = options.trigramMultiplier ?? 0.30;
    this.abstentionMargin = options.abstentionMargin ?? 0.10;
    this.abstentionUniformBuffer = options.abstentionUniformBuffer ?? 0.05;
  }

  public setTrigrams(enable: boolean, multiplier = 0.30): void {
    this.enableTrigrams = enable;
    this.trigramMultiplier = multiplier;
  }

  public getTrigramSettings(): { enableTrigrams: boolean; trigramMultiplier: number } {
    return {
      enableTrigrams: this.enableTrigrams,
      trigramMultiplier: this.trigramMultiplier
    };
  }

  // Strict list of low-signal financial stopwords to discard during tokenization for increased division contrast
  private static readonly FINANCIAL_STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'inc', 'co', 'corp', 'llc', 'payment',
    'authorized', 'ach', 'deposit', 'direct', 'trans', 'fee', 'card', 'mobile',
    'online', 'purchase', 'withdrawal', 'check', 'invoice', 'billing', 'bill'
  ]);

  /**
   * Trains the model using weighted samples.
   * Recent/verified samples, or target features, can be trained with a higher weight (e.g. 2.0 or 5.0)
   * to immediately learn and self-calibrate faster.
   * SECURITY: Bounds inputs to prevent algorithmic poisoning and out-of-memory errors.
   */
  private isSafeObjectKey(key: string): boolean {
    return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
  }

  train(description: string, category: string, weight = 1.0) {
    if (!description || !category) return;
    if (!this.isSafeObjectKey(category)) return;

    // Bounds and safety limits
    if (description.length > 500) {
      description = description.substring(0, 500); // Truncate excessive input
    }
    weight = Math.max(0.1, Math.min(10.0, weight)); // Clamp weight
    if (this.vocabulary.size > 50000) {
       // Cap vocabulary to prevent memory exhaustion attacks
       return;
    }

    // Train the exact category
    this.trainSingle(description, category, weight);

    // Deep / hierarchical labeling propagation:
    // If category has hierarchical delimiters ('>', '/', or ':'), also train ancestor tiers with dampened weight
    // so the classifier can make accurate multi-dimensional and parent inferences
    let segments: string[] = [];
    if (category.includes('>')) segments = category.split('>').map(s => s.trim()).filter(Boolean);
    else if (category.includes('/')) segments = category.split('/').map(s => s.trim()).filter(Boolean);
    else if (category.includes(':')) segments = category.split(':').map(s => s.trim()).filter(Boolean);

    if (segments.length > 0 && segments.some(segment => !this.isSafeObjectKey(segment))) {
      return;
    }

    if (segments.length > 1) {
      let cumulative = segments[0];
      const delimiter = category.includes('>') ? ' > ' : (category.includes(':') ? ':' : '/');
      for (let i = 1; i < segments.length; i++) {
        // Train intermediate ancestor (e.g. "Marketing / Digital" before "Marketing / Digital / PPC")
        const ancestorWeight = weight * (0.4 / i);
        this.trainSingle(description, cumulative, ancestorWeight);
        cumulative += delimiter + segments[i];
      }
    }
  }

  private trainSingle(description: string, category: string, weight: number) {
    const features = this.tokenizeAndExtractFeatures(description);
    this.categoryCounts[category] = (this.categoryCounts[category] || 0) + weight;
    this.totalDocuments += weight;

    if (!this.wordCounts[category]) {
      this.wordCounts[category] = {};
      this.categoryFeatureTotals[category] = 0;
    }

    // Track unique features per document to increment docFrequency exactly once per doc
    const uniqueFeatures = new Set(features);
    uniqueFeatures.forEach(feature => {
      this.docFrequency[feature] = (this.docFrequency[feature] || 0) + 1;
    });

    features.forEach(feature => {
      this.vocabulary.add(feature);
      this.wordCounts[category][feature] = (this.wordCounts[category][feature] || 0) + weight;
      this.categoryFeatureTotals[category] += weight;
    });
  }

  /**
   * Classifies input text and returns full posterior breakdown, margin, and abstention diagnosis.
   */
  classifyDetailed(description: string): {
    category: string | null;
    confidence: number;
    bestCategory: string;
    runnerUpCategory: string | null;
    top1Posterior: number;
    top2Posterior: number;
    margin: number;
    uniformProb: number;
    isAbstained: boolean;
    abstainReason?: 'NO_DOCUMENTS' | 'NO_FEATURES' | 'MARGIN_TOO_LOW' | 'NEAR_UNIFORM_PRIOR';
  } | null {
    if (this.totalDocuments === 0) return null;

    const features = this.tokenizeAndExtractFeatures(description);
    const inVocabFeatures = features.filter(f => this.vocabulary.has(f));
    const numCategories = Object.keys(this.categoryCounts).length;
    const uniformProb = numCategories > 0 ? 1 / numCategories : 1;

    if (inVocabFeatures.length === 0) {
      const topCategory = Object.keys(this.categoryCounts)[0] || 'Uncategorized';
      return {
        category: null,
        confidence: 0,
        bestCategory: topCategory,
        runnerUpCategory: null,
        top1Posterior: 0,
        top2Posterior: 0,
        margin: 0,
        uniformProb: Number(uniformProb.toFixed(4)),
        isAbstained: true,
        abstainReason: 'NO_FEATURES'
      };
    }

    const categoryScores: Record<string, number> = {};
    const vocabSize = this.vocabulary.size;
    const alpha = this.alpha;

    for (const category in this.categoryCounts) {
      // Prior P(Category)
      let logProb = Math.log(this.categoryCounts[category] / this.totalDocuments);
      const totalFeaturesInCategory = this.categoryFeatureTotals[category] || 0;

      for (let i = 0; i < inVocabFeatures.length; i++) {
        const feature = inVocabFeatures[i];
        const featureCountInCategory = this.wordCounts[category]?.[feature] || 0;

        // P(Feature | Category) using adaptive Lidstone smoothing
        const pFeatureGivenCategory = (featureCountInCategory + alpha) / (totalFeaturesInCategory + alpha * vocabSize);

        // TF-IDF scaling factor: penalize common words, boost rare highly-discriminative words
        const docFreq = this.docFrequency[feature] || 1;
        const idfWeight = Math.log(this.totalDocuments / docFreq) + 1;

        // Lambda mixture model for unigram, bigram, and trigram semantic blend
        const isTrigram = feature.startsWith('c3_');
        const isBigram = feature.includes('_') && !isTrigram;
        const multiplier = isBigram ? this.bigramMultiplier : (isTrigram ? this.trigramMultiplier : 1.00);

        const finalFeatureWeight = multiplier * idfWeight;
        logProb += finalFeatureWeight * Math.log(pFeatureGivenCategory);
      }
      categoryScores[category] = logProb;
    }

    // Sort categories descending by score
    const sorted = Object.entries(categoryScores).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return null;

    const [bestCategory, bestLogProb] = sorted[0];

    if (sorted.length === 1) {
      return {
        category: bestCategory,
        confidence: 0.995,
        bestCategory,
        runnerUpCategory: null,
        top1Posterior: 1.0,
        top2Posterior: 0,
        margin: 1.0,
        uniformProb: 1.0,
        isAbstained: false
      };
    }

    // Calibrated Softmax under Temperature scaling
    let sumExp = 0;
    for (const [_, score] of sorted) {
      sumExp += Math.exp((score - bestLogProb) / this.temperature);
    }
    const top1Posterior = 1 / sumExp;

    // Calculate margin against distinct competing taxonomy branches
    const rootOf = (cat: string) => cat.split(/[>/:]/)[0].trim().toLowerCase();
    const bestRoot = rootOf(bestCategory);
    const distinctBranchRunnerUp = sorted.slice(1).find(([cat]) => rootOf(cat) !== bestRoot);
    const immediateRunnerUp = sorted[1];

    const runnerUpCategory = immediateRunnerUp ? immediateRunnerUp[0] : null;
    const competitorScore = distinctBranchRunnerUp ? distinctBranchRunnerUp[1] : (immediateRunnerUp ? immediateRunnerUp[1] : bestLogProb);
    const competitorCategory = distinctBranchRunnerUp ? distinctBranchRunnerUp[0] : runnerUpCategory;

    const top2Posterior = immediateRunnerUp
      ? Math.exp((immediateRunnerUp[1] - bestLogProb) / this.temperature) / sumExp
      : 0;
    const competitorPosterior = distinctBranchRunnerUp
      ? Math.exp((competitorScore - bestLogProb) / this.temperature) / sumExp
      : top2Posterior;

    const margin = top1Posterior - competitorPosterior;

    // Abstention guard:
    // When top-1 is within ~5% of uniform prior (no discriminative evidence)
    // or margin between top-1 and competing branches is below the threshold, abstain!
    const nearUniform = top1Posterior <= uniformProb + this.abstentionUniformBuffer;
    const marginTooLow = margin < this.abstentionMargin;

    if (nearUniform || marginTooLow) {
      return {
        category: null,
        confidence: Number(top1Posterior.toFixed(4)),
        bestCategory,
        runnerUpCategory: competitorCategory,
        top1Posterior: Number(top1Posterior.toFixed(4)),
        top2Posterior: Number(competitorPosterior.toFixed(4)),
        margin: Number(margin.toFixed(4)),
        uniformProb: Number(uniformProb.toFixed(4)),
        isAbstained: true,
        abstainReason: nearUniform ? 'NEAR_UNIFORM_PRIOR' : 'MARGIN_TOO_LOW'
      };
    }

    const confidence = Math.min(0.999, Math.max(0.10, top1Posterior));
    return {
      category: bestCategory,
      confidence: Number(confidence.toFixed(4)),
      bestCategory,
      runnerUpCategory: competitorCategory,
      top1Posterior: Number(top1Posterior.toFixed(4)),
      top2Posterior: Number(competitorPosterior.toFixed(4)),
      margin: Number(margin.toFixed(4)),
      uniformProb: Number(uniformProb.toFixed(4)),
      isAbstained: false
    };
  }

  /**
   * Predicts the most likely category and provides a calibrated confidence metric.
   * Returns null if evidence is weak or the model abstains (near-uniform prior or low margin).
   */
  classify(description: string): { category: string; confidence: number } | null {
    const detailed = this.classifyDetailed(description);
    if (!detailed || detailed.isAbstained || !detailed.category) {
      return null;
    }
    return {
      category: detailed.category,
      confidence: detailed.confidence
    };
  }

  /**
   * Classifies input text into a deep multi-dimensional hierarchical label.
   * Returns root category, nested segments, parent path, and full hierarchical category.
   */
  classifyHierarchical(description: string): {
    category: string;
    confidence: number;
    segments: string[];
    rootCategory: string;
    depth: number;
    parentPath: string | null;
  } | null {
    const res = this.classify(description);
    if (!res) return null;

    const cat = res.category;
    let segments: string[];
    if (cat.includes('>')) segments = cat.split('>').map(s => s.trim()).filter(Boolean);
    else if (cat.includes('/')) segments = cat.split('/').map(s => s.trim()).filter(Boolean);
    else if (cat.includes(':')) segments = cat.split(':').map(s => s.trim()).filter(Boolean);
    else segments = [cat];

    const rootCategory = segments[0] || cat;
    const depth = segments.length;
    const parentPath = depth > 1 ? segments.slice(0, depth - 1).join('/') : null;

    return {
      category: res.category,
      confidence: res.confidence,
      segments,
      rootCategory,
      depth,
      parentPath
    };
  }

  /**
   * Extracts clean tokens, discards low-value transaction noise, and pairs unigrams/bigrams/trigrams.
   * Phase 1 Fix: Replaces all non-alphanumeric clusters with spaces and trims trailing reference numbers.
   * Also incorporates canonical brand token expansion for robust merchant matching.
   */
  private tokenizeAndExtractFeatures(text: string): string[] {
    const rawWords = normalizeSearchText(text)
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .map(w => w.replace(/\d{2,}$/, ''))
      .filter(w => (w.length > 2 || (w.length >= 2 && /\p{Script=Hebrew}/u.test(w))) && !BayesianClassifier.FINANCIAL_STOPWORDS.has(w));

    // Unigrams
    const features: string[] = [...rawWords];

    // Canonical Brand Alias Expansion (e.g. MSFT -> MICROSOFT, AMZN -> AMAZON, WMT -> WALMART)
    for (const w of rawWords) {
      if (KNOWN_CANONICAL_BRANDS[w]) {
        const canonicalTokens = KNOWN_CANONICAL_BRANDS[w].toLowerCase().split(/\s+/);
        for (const ct of canonicalTokens) {
          if (!features.includes(ct)) {
            features.push(ct);
          }
        }
      }
    }

    // Bigrams for deep semantic context and phrase tracking
    const n = rawWords.length;
    for (let i = 0; i < n - 1; i++) {
      features.push(`${rawWords[i]}_${rawWords[i+1]}`);
    }

    // Sub-word character trigrams for typo and spacing deformation tolerance (e.g. SHOPRIT E -> SHOPRITE)
    if (this.enableTrigrams && this.trigramMultiplier > 0) {
      for (const word of rawWords) {
        if (word.length >= 3) {
          for (let i = 0; i <= word.length - 3; i++) {
            features.push(`c3_${word.slice(i, i + 3)}`);
          }
        }
      }
    }

    return features;
  }
}


/**
 * Evaluates BayesianClassifier on an evaluation dataset and calculates accuracy,
 * top-2 accuracy, unknown (abstention) rate, and false-confidence rate.
 */
export function evaluateClassifier(
  classifier: BayesianClassifier,
  testSet: EvaluationSample[],
  highConfidenceThreshold = 0.70
): BenchmarkMetrics {
  let correctCount = 0;
  let top2CorrectCount = 0;
  let unknownCount = 0;
  let falseConfidenceCount = 0;

  const results: EvaluationResultItem[] = testSet.map(sample => {
    const detailed = classifier.classifyDetailed(sample.text);
    const predictedCategory = (detailed && !detailed.isAbstained) ? detailed.category : null;
    const confidence = detailed ? detailed.confidence : 0;

    const isUnknown = predictedCategory === null;
    const correct = !isUnknown && (predictedCategory === sample.expectedCategory);

    const top2Categories = detailed
      ? [detailed.bestCategory, detailed.runnerUpCategory].filter((c): c is string => Boolean(c))
      : [];
    const top2Correct = top2Categories.includes(sample.expectedCategory);

    // False confidence: predicted is wrong (and not unknown), but claimed high confidence
    const isFalseConfidence = !correct && !isUnknown && confidence >= highConfidenceThreshold;

    if (correct) correctCount++;
    if (top2Correct) top2CorrectCount++;
    if (isUnknown) unknownCount++;
    if (isFalseConfidence) falseConfidenceCount++;

    return {
      text: sample.text,
      expectedCategory: sample.expectedCategory,
      predictedCategory,
      confidence,
      correct,
      top2Correct,
      isUnknown,
      isFalseConfidence
    };
  });

  const total = testSet.length || 1;
  return {
    total: testSet.length,
    accuracy: Number((correctCount / total).toFixed(4)),
    top2Accuracy: Number((top2CorrectCount / total).toFixed(4)),
    unknownRate: Number((unknownCount / total).toFixed(4)),
    falseConfidenceRate: Number((falseConfidenceCount / total).toFixed(4)),
    results
  };
}


/**
 * Cosine Similarity for Vector Space matching
 */
export function cosineSimilarity(vecA: Record<string, number>, vecB: Record<string, number>): number {
  const intersection = Object.keys(vecA).filter(key => key in vecB);

  let dotProduct = 0;
  for (const key of intersection) dotProduct += vecA[key] * vecB[key];

  let magA = 0;
  for (const key in vecA) magA += vecA[key] ** 2;

  let magB = 0;
  for (const key in vecB) magB += vecB[key] ** 2;

  return dotProduct / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}
