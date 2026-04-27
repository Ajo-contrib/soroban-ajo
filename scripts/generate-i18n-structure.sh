#!/bin/bash
# Script to generate translation files for all languages

set -e

LOCALES_DIR="packages/shared/locales"
LANGUAGES=("es" "fr" "sw" "ar" "pt" "zh")
TRANSLATION_FILES=("auth" "groups" "contributions" "leaderboard" "gamification" "wallet" "activity" "profile" "errors")

echo "Generating translation files for all languages..."

# Create a function to translate English to other languages using i18next structure
# For now, we'll use placeholders that can be filled in with proper translations

create_placeholder_translation() {
  local lang=$1
  local file=$2
  local en_path="${LOCALES_DIR}/en/${file}.json"
  local target_path="${LOCALES_DIR}/${lang}/${file}.json"
  
  if [ -f "$en_path" ] && [ ! -f "$target_path" ]; then
    cp "$en_path" "$target_path"
    echo "Created placeholder: $target_path"
  fi
}

# Copy English files to all language directories as placeholders
for lang in "${LANGUAGES[@]}"; do
  for file in "${TRANSLATION_FILES[@]}"; do
    create_placeholder_translation "$lang" "$file"
  done
done

echo "Translation file structure created!"
