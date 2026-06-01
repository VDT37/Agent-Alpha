// SPDX-License-Identifier: MIT
// Minimal constant-product pool holding mUSD + mETH, where the vault executes swaps.
pragma solidity ^0.8.20;

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract SimpleAMM {
    IERC20Minimal public immutable token0; // e.g. mUSD
    IERC20Minimal public immutable token1; // e.g. mETH

    uint256 public reserve0;
    uint256 public reserve1;

    uint256 private unlocked = 1;
    modifier lock() {
        require(unlocked == 1, "LOCKED");
        unlocked = 0;
        _;
        unlocked = 1;
    }

    event LiquidityAdded(uint256 amount0, uint256 amount1);
    event Swapped(address indexed tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(address _token0, address _token1) {
        token0 = IERC20Minimal(_token0);
        token1 = IERC20Minimal(_token1);
    }

    // Seed the pool. Caller must approve this contract for both tokens first.
    function addLiquidity(uint256 amount0, uint256 amount1) external lock {
        require(amount0 > 0 && amount1 > 0, "ZERO_AMOUNT");
        token0.transferFrom(msg.sender, address(this), amount0);
        token1.transferFrom(msg.sender, address(this), amount1);
        reserve0 += amount0;
        reserve1 += amount1;
        emit LiquidityAdded(amount0, amount1);
    }

    // Constant-product quote with a 0.3% fee (same 997/1000 as the tutorial).
    function getAmountOut(address tokenIn, uint256 amountIn) public view returns (uint256 amountOut) {
        require(amountIn > 0, "ZERO_INPUT");
        require(tokenIn == address(token0) || tokenIn == address(token1), "BAD_TOKEN");

        (uint256 reserveIn, uint256 reserveOut) = tokenIn == address(token0)
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
        require(reserveIn > 0 && reserveOut > 0, "NO_LIQUIDITY");

        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    // Swap amountIn of tokenIn for the other token. Caller must approve first.
    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut)
        external
        lock
        returns (uint256 amountOut)
    {
        require(tokenIn == address(token0) || tokenIn == address(token1), "BAD_TOKEN");
        amountOut = getAmountOut(tokenIn, amountIn);
        require(amountOut >= minAmountOut, "SLIPPAGE");

        if (tokenIn == address(token0)) {
            token0.transferFrom(msg.sender, address(this), amountIn);
            token1.transfer(msg.sender, amountOut);
            reserve0 += amountIn;
            reserve1 -= amountOut;
        } else {
            token1.transferFrom(msg.sender, address(this), amountIn);
            token0.transfer(msg.sender, amountOut);
            reserve1 += amountIn;
            reserve0 -= amountOut;
        }
        emit Swapped(tokenIn, amountIn, amountOut);
    }
}