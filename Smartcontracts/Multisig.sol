// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

/// @title Multisig Wallet
/// @notice A simple multisignature wallet that requires multiple owners to approve transactions.
/// @dev Learning/demo project — not production-ready. Inspired by Gnosis Safe basics.
contract Multisig {
    uint256 private immutable _requiredSignature;
    address[] private _owners;
    mapping(address => bool) private _isOwner;

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
    }

    Transaction[] private _transactions;

    // Mapping of transactionId => owner => signed
    mapping(uint256 => mapping(address => bool)) private _signatures;

    /// @notice Emitted when a new transaction is created.
    event TransactionCreated(uint256 indexed transactionId, address indexed to, uint256 value, bytes data);

    /// @notice Emitted when an owner signs a transaction.
    event TransactionSigned(uint256 indexed transactionId, address indexed signer);

    /// @notice Emitted when a transaction is executed.
    event TransactionExecuted(uint256 indexed transactionId, address indexed executer);

    /// @notice Emitted when a transaction is cancelled.
    event TransactionCancelled(uint256 indexed transactionId, address indexed cancelledBy);

    /// @param owners The list of owners who can sign transactions.
    /// @param requiredSignature The number of signatures required for execution.
    constructor(address[] memory owners, uint256 requiredSignature) {
        require(owners.length > 0, "At least one owner required");
        require(requiredSignature > 0 && requiredSignature <= owners.length, "Invalid number of required signatures");

        for (uint256 i = 0; i < owners.length; i++) {
            address owner = owners[i];
            require(owner != address(0), "Invalid owner");
            require(!_isOwner[owner], "Duplicate owner not allowed");

            _isOwner[owner] = true;
            _owners.push(owner);
        }

        _requiredSignature = requiredSignature;
    }

    /// @notice Returns whether an address is an owner.
    function isOwner(address account) public view returns (bool) {
        return _isOwner[account];
    }

    /// @notice Returns the number of signatures collected for a transaction.
    function countSignature(uint256 transactionId) private view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < _owners.length; i++) {
            if (_signatures[transactionId][_owners[i]]) {
                count++;
            }
        }
        return count;
    }

    /// @notice Returns details of a transaction.
    function getTransaction(uint256 transactionId) public view returns (address, uint256, bytes memory, bool, uint256) {
        require(transactionId < _transactions.length, "Invalid transaction ID");

        Transaction storage transaction = _transactions[transactionId];
        return (
            transaction.to,
            transaction.value,
            transaction.data,
            transaction.executed,
            countSignature(transactionId)
        );
    }

    /// @notice Returns all owners.
    function getOwners() public view returns (address[] memory) {
        return _owners;
    }

    /// @notice Returns the required number of signatures.
    function getRequired() public view returns (uint256) {
        return _requiredSignature;
    }

    /// @notice Allows the contract to receive ETH.
    receive() external payable {}

    /// @notice Submits a new transaction proposal.
    function submitTransaction(address to, uint256 value, bytes memory data) public {
        require(isOwner(msg.sender), "Not an owner");
        require(to != address(0), "Invalid destination address");

        uint256 transactionId = _transactions.length;
        _transactions.push(Transaction({
            to: to,
            value: value,
            data: data,
            executed: false
        }));

        emit TransactionCreated(transactionId, to, value, data);
    }

    /// @notice Signs and possibly executes a transaction.
    function signTransaction(uint256 transactionId) public {
        require(transactionId < _transactions.length, "Invalid transaction ID");
        Transaction storage transaction = _transactions[transactionId];
        require(!transaction.executed, "Transaction already executed");
        require(isOwner(msg.sender), "Only owners can sign transactions");
        require(!_signatures[transactionId][msg.sender], "Transaction already signed");

        _signatures[transactionId][msg.sender] = true;
        emit TransactionSigned(transactionId, msg.sender);

        if (countSignature(transactionId) >= _requiredSignature) {
            executeTransaction(transactionId);
        }
    }

    /// @notice Executes a transaction once enough signatures are collected.
    function executeTransaction(uint256 transactionId) private {
        require(transactionId < _transactions.length, "Invalid transaction ID");
        Transaction storage transaction = _transactions[transactionId];
        require(!transaction.executed, "Transaction already executed");
        require(countSignature(transactionId) >= _requiredSignature, "Not enough signatures");

        transaction.executed = true;
        (bool success,) = transaction.to.call{value: transaction.value}(transaction.data);
        require(success, "Transaction execution failed");
        emit TransactionExecuted(transactionId, msg.sender);
    }

    /// @notice Cancels a transaction before execution.
    function cancelTransaction(uint256 transactionId) public {
        require(isOwner(msg.sender), "Not an owner");
        require(transactionId < _transactions.length, "Invalid transaction ID");

        Transaction storage transaction = _transactions[transactionId];
        require(!transaction.executed, "Already executed");

        transaction.executed = true; // Mark it as closed
        emit TransactionCancelled(transactionId, msg.sender);
    }
}
