# Contributing to Soroban Ajo

Thank you for your interest in contributing to Soroban Ajo! 🎉

This project aims to bring traditional African savings systems to the blockchain, making financial tools more accessible globally. We welcome contributions from developers, designers, documentation writers, and community members.

## 🌟 Ways to Contribute

- 🐛 Report bugs
- 💡 Suggest features
- 📝 Improve documentation
- 🔧 Submit code fixes
- 🧪 Add tests
- 🌍 Translate content
- 📣 Spread the word

## 🚀 Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (1.70+)
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup)
- Git

### Setup

1. **Fork the repository**
   ```bash
   # Click "Fork" on GitHub, then:
   git clone https://github.com/Christopherdominic/soroban-ajo.git
   cd soroban-ajo
   ```

2. **Build the project**
   ```bash
   ./scripts/build.sh
   ```

3. **Run tests**
   ```bash
   ./scripts/test.sh
   ```

4. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

## 📋 Finding Issues to Work On

### For First-Time Contributors

Look for issues labeled:
- `good first issue` - Perfect for newcomers
- `documentation` - Help improve docs
- `help wanted` - We need assistance

### For Experienced Contributors

- `wave-ready` - Ready for Drips Wave contributors
- `enhancement` - New features
- `performance` - Optimization work

### Issue Complexity Levels

- **Trivial** (100 pts) - 1-2 hours, clear scope
- **Medium** (150 pts) - 3-6 hours, moderate complexity
- **High** (200 pts) - 1-2 days, significant changes

## 🔧 Development Workflow

### 1. Claim an Issue

Comment on the issue: "I'd like to work on this!" 

Maintainers will assign it to you within 24 hours.

### 2. Work on Your Changes

**For Contract Changes:**
```bash
cd contracts/ajo
# Make your changes
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
```

**For Documentation:**
- Use clear, concise language
- Add code examples where helpful
- Check spelling and grammar

**For Scripts:**
- Make scripts executable: `chmod +x scripts/your_script.sh`
- Test on your local system
- Add comments explaining each step

### 3. Write Tests

**Required:**
- Add tests for new features
- Update tests for modified functionality
- Ensure all tests pass

**Example test structure:**
```rust
#[test]
fn test_your_feature() {
    let (env, client, user) = setup_test_env();
    
    // Arrange
    // ... setup
    
    // Act
    client.your_function(&user);
    
    // Assert
    assert_eq!(expected, actual);
}
```

### 4. Commit Your Changes

Use conventional commits:
```bash
git commit -m "feat: add timeout mechanism for contributions"
git commit -m "fix: prevent double payout in edge case"
git commit -m "docs: improve architecture diagram"
git commit -m "test: add coverage for group completion"
```

**Commit types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `test:` - Adding tests
- `refactor:` - Code restructuring
- `perf:` - Performance improvement
- `chore:` - Maintenance tasks

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## ✅ Pull Request Checklist

Before submitting your PR, ensure:

- [ ] Code builds without errors
- [ ] All tests pass (`cargo test`)
- [ ] Code is formatted (`cargo fmt --all -- --check`)
- [ ] No clippy warnings (`cargo clippy --all-targets -- -D warnings`) **← CI GATE**
- [ ] PR message closes the issue e.g #closes issue 20
- [ ] Commit messages follow conventional commits
- [ ] PR description explains what and why
- [ ] Linked to related issue (if applicable)

## 📝 PR Description Template

```markdown
## Description
Brief description of changes

## Related Issue
Fixes #123

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Refactoring
- [ ] Performance improvement

## Testing
Describe how you tested this

## Screenshots (if applicable)
Add screenshots for UI changes

## Checklist
- [ ] Tests pass
- [ ] Code formatted
- [ ] Documentation updated
```

## 🎨 Code Style

### Rust Code

Follow [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/):

```rust
// Good: Clear function names, proper error handling
pub fn create_group(
    env: Env,
    creator: Address,
    contribution_amount: i128,
    cycle_duration: u64,
    max_members: u32,
) -> Result<u64, AjoError> {
    // Validate inputs
    utils::validate_group_params(contribution_amount, cycle_duration, max_members)?;
    
    // Require authentication
    creator.require_auth();
    
    // ... implementation
}
```

**Key principles:**
- Use meaningful variable names
- Add comments for complex logic
- Keep functions focused (single responsibility)
- Handle all error cases explicitly
- Write tests for public functions

### Clippy Lints (CI Gate)

All Rust code must pass `cargo clippy --all-targets -- -D warnings`. This is enforced in CI.

**Common clippy patterns to watch for:**

```rust
// ❌ DON'T: Needless clone
function_call(value.clone())  // if value is not used after

// ✅ DO: Pass by reference or move
function_call(value)

// ❌ DON'T: Unneeded checked arithmetic without handling
let result = a.checked_add(b).unwrap_or(0);  // silently caps at 0?

// ✅ DO: Use appropriate arithmetic
let result = a.checked_add(b).expect("overflow");  // or use saturating_add if correct
let result = a.saturating_add(b);

// ❌ DON'T: Redundant closure
.map(|x| x.to_string())

// ✅ DO: Use method reference
.map(ToString::to_string)

// ❌ DON'T: Unused variables
let result = some_call();  // if result is never used

// ✅ DO: Remove or prefix with underscore
let _result = some_call();  // or just call some_call();

// ❌ DON'T: Dead code without explanation
fn unused_helper() { ... }

// ✅ DO: Add comment or #[allow(dead_code)]
#[allow(dead_code)]
/// This helper is used by tests and future features
fn unused_helper() { ... }
```

**Before submitting a PR with Rust changes:**

```bash
cd contracts/ajo

# Run all three checks locally — CI will enforce all three:
cargo fmt --all -- --check      # formatting
cargo clippy --all-targets -- -D warnings  # lints (CI gate)
cargo test --workspace          # tests
```

If clippy reports any warnings, fix them before pushing. Warnings are treated as errors in CI (`-D warnings`).

If you believe a warning is a false positive, add a comment explaining why:

```rust
#[allow(clippy::specific_lint)]
// REASON: This pattern is intentional because...
let value = some_operation();
```

### Documentation

```rust
/// Create a new Ajo group
///
/// # Arguments
/// * `creator` - Address of the group creator
/// * `contribution_amount` - Fixed amount per member per cycle
/// * `cycle_duration` - Duration in seconds
/// * `max_members` - Maximum allowed members
///
/// # Returns
/// The unique group ID
///
/// # Errors
/// * `InvalidAmount` - If contribution_amount <= 0
/// * `InvalidCycleDuration` - If cycle_duration == 0
/// * `InvalidMaxMembers` - If max_members < 2
pub fn create_group(...) -> Result<u64, AjoError> {
    // ...
}
```

## 🧪 Testing Guidelines

### Test Structure

```rust
#[test]
fn test_feature_name() {
    // Arrange - Set up test environment
    let (env, client, user1, user2) = setup_test_env();
    
    // Act - Perform the action being tested
    let result = client.some_function(&user1);
    
    // Assert - Verify expected behavior
    assert_eq!(expected, result);
}
```

### Test Coverage

Aim for:
- **Unit tests**: Test individual functions
- **Integration tests**: Test full workflows
- **Edge cases**: Test boundary conditions
- **Error cases**: Test error handling

## 🐛 Reporting Bugs

### Before Reporting

1. Check if bug already reported in [Issues](https://github.com/Christopherdominic/soroban-ajo/issues)
2. Verify it's a bug (not expected behavior)
3. Test on latest version

### Bug Report Template

Use our [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md)

Include:
- Clear description
- Steps to reproduce
- Expected vs actual behavior
- Environment details
- Relevant logs/screenshots

## 💡 Suggesting Features

### Feature Request Template

Use our [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md)

Include:
- Problem being solved
- Proposed solution
- Alternative solutions considered
- How it aligns with project goals

## 📚 Documentation Contributions

Documentation is crucial! Help us by:

- Fixing typos or unclear explanations
- Adding examples
- Translating content
- Creating tutorials
- Improving code comments

## 🌍 Translation

We want to reach global audiences. Help translate:

- README.md
- User guides
- Error messages
- UI text (future)

**Priority languages:**
- Yoruba (Nigeria)
- Swahili (Kenya, Tanzania)
- French (West Africa)
- Amharic (Ethiopia)
- Arabic (North Africa)

## 💬 Community

### Get Help

- **GitHub Discussions**: Ask questions, share ideas
- **Discord**: Real-time chat (link in README)
- **Issues**: Report bugs, request features

### Code of Conduct

We are committed to providing a welcoming environment. Please read our [Code of Conduct](CODE_OF_CONDUCT.md).

## 🏆 Recognition

Contributors are recognized in:
- [CONTRIBUTORS.md](CONTRIBUTORS.md)
- Release notes
- Project README

Top contributors may be invited to join the core team!

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## ❓ Questions?

- Open a [Discussion](https://github.com/Christopherdominic/soroban-ajo/discussions)
- Ask in Discord
- Email: Chriseze0@gmail.com

## 🙏 Thank You!

Every contribution matters - from fixing a typo to building a major feature. Thank you for helping make financial tools more accessible! 🌍

---

**Happy Contributing!** 🚀
