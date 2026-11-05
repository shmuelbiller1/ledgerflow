import { useCallback } from 'react';
import React from 'react';
import { useUIStore } from '../stores/useUIStore';
import { SYSTEM_GLOSSARY } from '../config/systemGlossary';

/**
 * Enterprise Lexicon Translation Hook
 * Handles localization and hot-swappable live overrides for any text card, title, or label.
 */
function useLexicon() {
  const language = useUIStore(state => state.language);
  const lexiconOverrides = useUIStore(state => state.lexiconOverrides);

  const t = useCallback((key: string, defaultVal?: string): string => {
    // 1. Check live user overrides first
    if (lexiconOverrides[key] && lexiconOverrides[key][language]) {
      return lexiconOverrides[key][language];
    }

    // 2. Resolve from central vocabulary registry
    const registryEntry = SYSTEM_GLOSSARY[key];
    if (registryEntry) {
      return registryEntry[language] || registryEntry['en'] || key;
    }

    // 3. Fallback to inline default
    return defaultVal || key;
  }, [language, lexiconOverrides]);

  return { t, language };
}

interface LexiconTextProps {
  cardKey: string;
  defaultVal: string;
  className?: string;
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'div';
}

/**
 * Self-Aware Copy Component
 * Renders simple localized copy dynamically from the central glossary.
 */
export const LexiconText: React.FC<LexiconTextProps> = ({
  cardKey,
  defaultVal,
  className = '',
  as = 'span'
}) => {
  const { t } = useLexicon();
  const textValue = t(cardKey, defaultVal);
  const Tag = as;

  return <Tag className={className}>{textValue}</Tag>;
};
