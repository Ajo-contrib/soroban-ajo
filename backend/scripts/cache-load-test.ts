#!/usr/bin/env node

/**
 * CACHE PERFORMANCE LOAD TEST
 * 
 * Tests cache hit rate, latency improvements, and system performance
 * under load with and without caching.
 * 
 * Usage: npm run load-test:cache
 */

import fetch from 'node-fetch'
import { cacheMonitor } from '../services/cacheMonitor'

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000'
const TEST_DURATION = 30000 // 30 seconds
const CONCURRENT_USERS = 10

interface TestMetrics {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  totalTime: number
  averageLatency: number
  minLatency: number
  maxLatency: number
  cacheHits: number
  cacheMisses: number
  hitRate: number
}

class CacheLoadTester {
  private metrics: TestMetrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalTime: 0,
    averageLatency: 0,
    minLatency: Infinity,
    maxLatency: 0,
    cacheHits: 0,
    cacheMisses: 0,
    hitRate: 0,
  }

  private latencies: number[] = []

  async runTest() {
    console.log('🚀 Starting Cache Performance Load Test')
    console.log(`📊 Test Configuration:`)
    console.log(`   Duration: ${TEST_DURATION / 1000}s`)
    console.log(`   Concurrent Users: ${CONCURRENT_USERS}`)
    console.log(`   API Base URL: ${API_BASE_URL}`)
    console.log('')

    const startTime = Date.now()
    const testEndTime = startTime + TEST_DURATION

    // Start monitoring
    cacheMonitor.startMonitoring(5000)

    // Run concurrent requests
    const promises: Promise<void>[] = []
    let requestCount = 0

    while (Date.now() < testEndTime) {
      // Spawn concurrent requests
      for (let i = 0; i < CONCURRENT_USERS; i++) {
        promises.push(this.makeRequest(requestCount++))
      }

      // Wait a bit before spawning more
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    // Wait for all requests to complete
    await Promise.all(promises)

    const totalTime = Date.now() - startTime
    this.metrics.totalTime = totalTime

    // Calculate final metrics
    this.metrics.averageLatency =
      this.latencies.length > 0
        ? this.latencies.reduce((a, b) => a + b) / this.latencies.length
        : 0

    await this.reportResults()
  }

  private async makeRequest(requestNumber: number) {
    try {
      const endpoints = ['/api/groups', '/api/users/stats', '/api/leaderboard/top']
      const endpoint = endpoints[requestNumber % endpoints.length]

      const startTime = Date.now()

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      const latency = Date.now() - startTime
      this.latencies.push(latency)

      this.metrics.totalRequests++
      this.metrics.minLatency = Math.min(this.metrics.minLatency, latency)
      this.metrics.maxLatency = Math.max(this.metrics.maxLatency, latency)

      if (response.status === 200) {
        this.metrics.successfulRequests++

        // Check cache header
        const cacheHeader = response.headers.get('x-cache')
        if (cacheHeader === 'HIT') {
          this.metrics.cacheHits++
        } else {
          this.metrics.cacheMisses++
        }
      } else {
        this.metrics.failedRequests++
      }
    } catch (error) {
      this.metrics.failedRequests++
      console.error(`❌ Request failed: ${error}`)
    }
  }

  private async reportResults() {
    const redisMetrics = await cacheMonitor.getMetrics()
    const health = await cacheMonitor.getHealthStatus()

    console.log('\n' + '═'.repeat(70))
    console.log('📈 LOAD TEST RESULTS')
    console.log('═'.repeat(70) + '\n')

    // Request Statistics
    console.log('📊 Request Statistics:')
    console.log(
      `   Total Requests: ${this.metrics.totalRequests}`.padEnd(50) +
        `(${(this.metrics.totalRequests / (this.metrics.totalTime / 1000)).toFixed(2)} req/s)`
    )
    console.log(
      `   Successful: ${this.metrics.successfulRequests}`.padEnd(50) +
        `(${((this.metrics.successfulRequests / this.metrics.totalRequests) * 100).toFixed(2)}%)`
    )
    console.log(
      `   Failed: ${this.metrics.failedRequests}`.padEnd(50) +
        `(${((this.metrics.failedRequests / this.metrics.totalRequests) * 100).toFixed(2)}%)`
    )

    // Cache Performance
    if (this.metrics.totalRequests > 0) {
      const total = this.metrics.cacheHits + this.metrics.cacheMisses
      const hitRate = total > 0 ? (this.metrics.cacheHits / total) * 100 : 0
      console.log('\n💾 Cache Performance:')
      console.log(`   Cache Hits: ${this.metrics.cacheHits}`)
      console.log(`   Cache Misses: ${this.metrics.cacheMisses}`)
      console.log(`   Cache Hit Rate: ${hitRate.toFixed(2)}%`)
    }

    // Latency Statistics
    console.log('\n⏱️  Latency Statistics (ms):')
    console.log(`   Average: ${this.metrics.averageLatency.toFixed(2)}`)
    console.log(`   Minimum: ${this.metrics.minLatency.toFixed(2)}`)
    console.log(`   Maximum: ${this.metrics.maxLatency.toFixed(2)}`)
    console.log(
      `   P95: ${this.calculatePercentile(95).toFixed(2)}`
    )
    console.log(
      `   P99: ${this.calculatePercentile(99).toFixed(2)}`
    )

    // Redis Metrics
    if (redisMetrics) {
      console.log('\n🔴 Redis Metrics:')
      console.log(`   Memory Used: ${redisMetrics.memoryUsed}`)
      console.log(`   Connected Clients: ${redisMetrics.connectedClients}`)
      console.log(`   Total Commands: ${redisMetrics.totalCommandsProcessed}`)
      console.log(`   Keyspace Hits: ${redisMetrics.keyspaceHits}`)
      console.log(`   Keyspace Misses: ${redisMetrics.keyspaceMisses}`)
      console.log(`   Hit Rate: ${redisMetrics.hitRate}%`)
    }

    // Health Status
    if (health) {
      console.log('\n🏥 Cache Health:')
      console.log(`   Status: ${health.isHealthy ? '✅ Healthy' : '❌ Unhealthy'}`)
      console.log(`   Memory Usage: ${health.memoryUsagePercent}%`)
      console.log(`   Hit Rate: ${health.hitRate}%`)
      if (health.warnings.length > 0) {
        console.log(`   ⚠️  Warnings:`)
        health.warnings.forEach((w) => console.log(`      - ${w}`))
      }
      if (health.errors.length > 0) {
        console.log(`   ❌ Errors:`)
        health.errors.forEach((e) => console.log(`      - ${e}`))
      }
    }

    console.log('\n' + '═'.repeat(70) + '\n')

    // Performance Assessment
    this.assessPerformance()
  }

  private calculatePercentile(percentile: number): number {
    if (this.latencies.length === 0) return 0
    const sorted = [...this.latencies].sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }

  private assessPerformance() {
    console.log('📋 Performance Assessment:\n')

    const throughput = this.metrics.totalRequests / (this.metrics.totalTime / 1000)
    const successRate =
      (this.metrics.successfulRequests / this.metrics.totalRequests) * 100

    // Throughput Assessment
    console.log(`Throughput: ${throughput.toFixed(2)} req/s`)
    if (throughput > 100) {
      console.log('  ✅ Excellent throughput')
    } else if (throughput > 50) {
      console.log('  👍 Good throughput')
    } else {
      console.log('  ⚠️  Low throughput - consider optimization')
    }

    // Success Rate Assessment
    console.log(`\nSuccess Rate: ${successRate.toFixed(2)}%`)
    if (successRate > 99) {
      console.log('  ✅ Excellent reliability')
    } else if (successRate > 95) {
      console.log('  👍 Good reliability')
    } else {
      console.log('  ⚠️  Check error handling')
    }

    // Cache Hit Rate Assessment
    const cacheHitRate = this.metrics.cacheHits + this.metrics.cacheMisses > 0
      ? (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses)) * 100
      : 0
    
    console.log(`\nCache Hit Rate: ${cacheHitRate.toFixed(2)}%`)
    if (cacheHitRate > 80) {
      console.log('  ✅ Excellent cache efficiency')
    } else if (cacheHitRate > 50) {
      console.log('  👍 Good cache efficiency')
    } else if (cacheHitRate > 0) {
      console.log('  ⚠️  Low cache efficiency - check invalidation strategy')
    } else {
      console.log('  ℹ️  First run - no cache hits expected')
    }

    // Latency Assessment
    console.log(`\nAverage Latency: ${this.metrics.averageLatency.toFixed(2)}ms`)
    if (this.metrics.averageLatency < 50) {
      console.log('  ✅ Excellent latency')
    } else if (this.metrics.averageLatency < 200) {
      console.log('  👍 Good latency')
    } else {
      console.log('  ⚠️  High latency - check system resources')
    }

    console.log('\n')
  }
}

// Run the test
const tester = new CacheLoadTester()
tester.runTest().catch(console.error)
